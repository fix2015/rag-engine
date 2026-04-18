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
const DEFAULT_RELEVANCE_THRESHOLD = 0.7

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
    let llmCalls = 0
    let retrievalTimeMs = 0
    let currentQuery = question

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
          [], trace, startTime, llmCalls, retrievalTimeMs,
        )
      }

      // Step 2: Judge relevance
      const chunksText = formatChunksForPrompt(chunks)
      let judgment: RelevanceJudgment

      try {
        judgment = await this.llm.chatJSON<RelevanceJudgment>([
          { role: 'system', content: RELEVANCE_JUDGE_SYSTEM },
          { role: 'user', content: RELEVANCE_JUDGE_USER(currentQuery, chunksText) },
        ], { jsonMode: true })
        llmCalls++
      } catch {
        // If JSON parsing fails, default to synthesize with current chunks
        judgment = { score: 0.5, decision: 'synthesize', reasoning: 'Fallback: judge parse failed' }
      }

      trace.push({
        action: 'evaluate',
        timestamp: Date.now(),
        score: judgment.score,
        decision: judgment.decision,
        reasoning: judgment.reasoning,
        attempt,
      })

      // Step 3: Act on decision
      if (judgment.decision === 'synthesize' || judgment.score >= this.config.relevanceThreshold) {
        const answer = await this.synthesize(question, chunks)
        llmCalls++
        trace.push({ action: 'synthesize', timestamp: Date.now(), attempt })
        return this.buildResult(answer, chunks, trace, startTime, llmCalls, retrievalTimeMs)
      }

      if (judgment.decision === 'rewrite' && judgment.rewrittenQuery) {
        currentQuery = judgment.rewrittenQuery
        trace.push({ action: 'rewrite', timestamp: Date.now(), newQuery: currentQuery })
        continue
      }

      if (judgment.decision === 'broaden' && judgment.rewrittenQuery) {
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
          [], trace, startTime, llmCalls, retrievalTimeMs,
        )
      }

      // Default: if no rewritten query, synthesize with what we have
      const answer = await this.synthesize(question, chunks)
      llmCalls++
      trace.push({ action: 'synthesize', timestamp: Date.now(), attempt })
      return this.buildResult(answer, chunks, trace, startTime, llmCalls, retrievalTimeMs)
    }

    // Max retries exhausted
    trace.push({
      action: 'give_up',
      timestamp: Date.now(),
      reasoning: 'Max retries exhausted.',
    })
    return this.buildResult(
      'I could not find a confident answer after multiple attempts.',
      [], trace, startTime, llmCalls, retrievalTimeMs,
    )
  }

  private async synthesize(question: string, chunks: ScoredChunk[]): Promise<string> {
    const chunksText = formatChunksForPrompt(chunks)
    const systemPrompt = this.config.systemPrompt
      ? `${this.config.systemPrompt}\n\n${SYNTHESIZE_SYSTEM}`
      : SYNTHESIZE_SYSTEM

    return this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: SYNTHESIZE_USER(question, chunksText) },
    ])
  }

  private buildResult(
    answer: string,
    sources: ScoredChunk[],
    trace: TraceEntry[],
    startTime: number,
    llmCalls: number,
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
        tokensUsed: 0, // TODO: track from LLM responses
      },
    }
  }
}
