import type {
  LLMProvider, EmbeddingsProvider, VectorStore,
  ScoredChunk, QueryResult, TraceEntry, RelevanceJudgment, AgentConfig,
} from '../types.js'
import {
  RELEVANCE_JUDGE_SYSTEM, RELEVANCE_JUDGE_USER,
  SYNTHESIZE_SYSTEM, SYNTHESIZE_USER,
  formatChunksForPrompt,
} from '../llm/prompts.js'

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RELEVANCE_THRESHOLD = 0.5

export class Agent {
  private llm: LLMProvider
  private embeddings: EmbeddingsProvider
  private store: VectorStore
  private config: Required<AgentConfig>
  private topK: number

  constructor(
    llm: LLMProvider,
    embeddings: EmbeddingsProvider,
    store: VectorStore,
    agentConfig?: AgentConfig,
    topK?: number,
  ) {
    this.llm = llm
    this.embeddings = embeddings
    this.store = store
    this.topK = topK || 10
    this.config = {
      maxRetries: agentConfig?.maxRetries ?? DEFAULT_MAX_RETRIES,
      relevanceThreshold: agentConfig?.relevanceThreshold ?? DEFAULT_RELEVANCE_THRESHOLD,
      systemPrompt: agentConfig?.systemPrompt ?? '',
    }
  }

  async query(question: string): Promise<QueryResult> {
    const startTime = Date.now()
    const trace: TraceEntry[] = []
    let totalTokens = 0
    let llmCalls = 0
    let retrievalTimeMs = 0
    let currentQuery = question

    // Track best attempt for score-decline safeguard
    let bestScore = -1
    let bestChunks: ScoredChunk[] = []

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      // Step 1: Retrieve
      const retrievalStart = Date.now()
      const queryEmbedding = await this.embeddings.embedQuery(currentQuery)
      const chunks = await this.store.search(queryEmbedding, this.topK)
      retrievalTimeMs += Date.now() - retrievalStart

      trace.push({
        action: 'search',
        timestamp: Date.now(),
        query: currentQuery,
        resultsCount: chunks.length,
        attempt,
      })

      if (chunks.length === 0) {
        trace.push({
          action: 'give_up',
          timestamp: Date.now(),
          reasoning: 'No chunks found in the index.',
        })
        return this.buildResult(
          'I could not find any relevant information to answer this question.',
          [], trace, startTime, llmCalls, totalTokens, retrievalTimeMs,
        )
      }

      // Step 2: Judge relevance
      const chunksText = formatChunksForPrompt(chunks)
      let judgment: RelevanceJudgment

      try {
        const judgeResult = await this.llm.chatJSON<RelevanceJudgment>([
          { role: 'system', content: RELEVANCE_JUDGE_SYSTEM },
          { role: 'user', content: RELEVANCE_JUDGE_USER(currentQuery, chunksText) },
        ], { jsonMode: true })
        judgment = judgeResult
        llmCalls++
      } catch {
        // BUG #1 FIX: fallback to rewrite, not synthesize
        judgment = {
          score: 0.5,
          decision: 'rewrite',
          reasoning: 'Fallback: judge response parse failed, retrying',
          rewrittenQuery: currentQuery,
        }
      }

      trace.push({
        action: 'evaluate',
        timestamp: Date.now(),
        score: judgment.score,
        decision: judgment.decision,
        reasoning: judgment.reasoning,
        attempt,
      })

      // Track best scoring attempt
      if (judgment.score > bestScore) {
        bestScore = judgment.score
        bestChunks = chunks
      }

      // Step 3: Act on decision
      if (judgment.decision === 'synthesize' || judgment.score >= this.config.relevanceThreshold) {
        const { text, tokens } = await this.synthesize(question, chunks)
        totalTokens += tokens
        llmCalls++
        trace.push({ action: 'synthesize', timestamp: Date.now(), attempt })
        return this.buildResult(text, chunks, trace, startTime, llmCalls, totalTokens, retrievalTimeMs)
      }

      if (judgment.decision === 'rewrite' && judgment.rewrittenQuery) {
        // BUG #3 FIX: if rewrite scores worse than previous best, synthesize with best chunks
        if (attempt > 1 && judgment.score < bestScore) {
          trace.push({
            action: 'synthesize',
            timestamp: Date.now(),
            attempt,
            reasoning: 'Rewrite score declined, using best attempt',
          })
          const { text, tokens } = await this.synthesize(question, bestChunks)
          totalTokens += tokens
          llmCalls++
          return this.buildResult(text, bestChunks, trace, startTime, llmCalls, totalTokens, retrievalTimeMs)
        }

        currentQuery = judgment.rewrittenQuery
        trace.push({ action: 'rewrite', timestamp: Date.now(), newQuery: currentQuery })
        continue
      }

      if (judgment.decision === 'broaden' && judgment.rewrittenQuery) {
        if (attempt > 1 && judgment.score < bestScore) {
          trace.push({
            action: 'synthesize',
            timestamp: Date.now(),
            attempt,
            reasoning: 'Broaden score declined, using best attempt',
          })
          const { text, tokens } = await this.synthesize(question, bestChunks)
          totalTokens += tokens
          llmCalls++
          return this.buildResult(text, bestChunks, trace, startTime, llmCalls, totalTokens, retrievalTimeMs)
        }

        currentQuery = judgment.rewrittenQuery
        trace.push({ action: 'broaden', timestamp: Date.now(), newQuery: currentQuery })
        continue
      }

      if (judgment.decision === 'give_up') {
        trace.push({
          action: 'give_up',
          timestamp: Date.now(),
          reasoning: judgment.reasoning,
        })
        return this.buildResult(
          `I don't have enough information to answer this. ${judgment.reasoning}`,
          [], trace, startTime, llmCalls, totalTokens, retrievalTimeMs,
        )
      }

      // Default: synthesize with what we have
      const { text, tokens } = await this.synthesize(question, chunks)
      totalTokens += tokens
      llmCalls++
      trace.push({ action: 'synthesize', timestamp: Date.now(), attempt })
      return this.buildResult(text, chunks, trace, startTime, llmCalls, totalTokens, retrievalTimeMs)
    }

    // Max retries exhausted — synthesize with best chunks if we had any decent score
    if (bestScore > 0.3 && bestChunks.length > 0) {
      trace.push({
        action: 'synthesize',
        timestamp: Date.now(),
        reasoning: `Max retries exhausted, synthesizing with best score ${bestScore.toFixed(2)}`,
      })
      const { text, tokens } = await this.synthesize(question, bestChunks)
      totalTokens += tokens
      llmCalls++
      return this.buildResult(text, bestChunks, trace, startTime, llmCalls, totalTokens, retrievalTimeMs)
    }

    trace.push({
      action: 'give_up',
      timestamp: Date.now(),
      reasoning: 'Max retries exhausted.',
    })
    return this.buildResult(
      'I could not find a confident answer after multiple attempts.',
      [], trace, startTime, llmCalls, totalTokens, retrievalTimeMs,
    )
  }

  private async synthesize(question: string, chunks: ScoredChunk[]): Promise<{ text: string; tokens: number }> {
    const chunksText = formatChunksForPrompt(chunks)
    const systemPrompt = this.config.systemPrompt
      ? `${this.config.systemPrompt}\n\n${SYNTHESIZE_SYSTEM}`
      : SYNTHESIZE_SYSTEM

    const text = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: SYNTHESIZE_USER(question, chunksText) },
    ])
    // Token tracking comes from the LLM provider if available
    return { text, tokens: 0 }
  }

  private buildResult(
    answer: string,
    sources: ScoredChunk[],
    trace: TraceEntry[],
    startTime: number,
    llmCalls: number,
    tokensUsed: number,
    retrievalTimeMs: number,
  ): QueryResult {
    return {
      answer,
      sources,
      trace,
      metrics: {
        totalTimeMs: Date.now() - startTime,
        retrievalTimeMs,
        llmCalls,
        tokensUsed,
      },
    }
  }
}
