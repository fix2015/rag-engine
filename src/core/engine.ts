import { resolve } from 'node:path'
import type {
  RagConfig, LLMProvider, EmbeddingsProvider, VectorStore,
  Chunker, IngestOptions, QueryResult, Chunk,
} from '../types.js'
import { Agent } from './agent.js'
import { OpenAILLM, OpenAIEmbeddings } from '../llm/openai.js'
import { MemoryStore } from '../stores/memory.js'
import { SlidingWindowChunker } from '../ingest/chunkers/sliding-window.js'
import { loadDirectory, loadFile } from '../ingest/loader.js'

export class RagEngine {
  private llm: LLMProvider
  private embeddings: EmbeddingsProvider
  private store: VectorStore
  private chunker: Chunker
  private agent: Agent
  private config: RagConfig

  private constructor(
    llm: LLMProvider,
    embeddings: EmbeddingsProvider,
    store: VectorStore,
    chunker: Chunker,
    agent: Agent,
    config: RagConfig,
  ) {
    this.llm = llm
    this.embeddings = embeddings
    this.store = store
    this.chunker = chunker
    this.agent = agent
    this.config = config
  }

  static async create(config: RagConfig = {}): Promise<RagEngine> {
    // Auto-detect LLM provider
    const llm = isLLMProvider(config.llm)
      ? config.llm
      : createLLM(config.llm)

    // Auto-detect embeddings provider
    const embeddings = isEmbeddingsProvider(config.embeddings)
      ? config.embeddings
      : createEmbeddings(config.embeddings)

    // Verify API connection works
    try {
      await embeddings.embedQuery('test')
    } catch (err) {
      throw new Error(`Failed to verify embeddings provider: ${(err as Error).message}`)
    }

    const store = config.store || new MemoryStore()
    const chunker = createChunker(config.chunker)
    const agent = new Agent(llm, embeddings, store, config.agent, config.retrieval?.topK)

    return new RagEngine(llm, embeddings, store, chunker, agent, config)
  }

  async ingest(pathOrText: string, options?: IngestOptions): Promise<{ chunksAdded: number; filesProcessed: number }> {
    const resolvedPath = resolve(pathOrText)
    let documents: { content: string; filePath: string }[]

    try {
      const stat = (await import('node:fs')).statSync(resolvedPath)
      if (stat.isDirectory()) {
        documents = loadDirectory(resolvedPath, options?.glob)
      } else {
        documents = [loadFile(resolvedPath)]
      }
    } catch {
      // Treat as raw text
      documents = [{ content: pathOrText, filePath: 'inline' }]
    }

    let totalChunks = 0

    for (const doc of documents) {
      const textChunks = this.chunker.chunk(doc.content, { file: doc.filePath })
      const chunks: Chunk[] = []

      const texts = textChunks.map(c => c.content)
      if (texts.length === 0) continue

      // Batch embed in groups of 100 to avoid API limits
      const BATCH_SIZE = 100
      const allEmbeddings: number[][] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE)
        const batchEmbeddings = await this.embeddings.embed(batch)
        allEmbeddings.push(...batchEmbeddings)
      }

      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          id: `${doc.filePath}:${textChunks[i].metadata.index ?? i}`,
          content: textChunks[i].content,
          embedding: allEmbeddings[i],
          metadata: textChunks[i].metadata,
        })
      }

      await this.store.add(chunks)
      totalChunks += chunks.length
    }

    return { chunksAdded: totalChunks, filesProcessed: documents.length }
  }

  async query(question: string): Promise<QueryResult> {
    if (this.store.count() === 0) {
      return {
        answer: 'No documents have been ingested yet. Call rag.ingest() first.',
        sources: [],
        trace: [{ action: 'give_up', timestamp: Date.now(), reasoning: 'Empty index' }],
        metrics: { totalTimeMs: 0, retrievalTimeMs: 0, llmCalls: 0, tokensUsed: 0 },
      }
    }
    return this.agent.query(question)
  }

  stats(): { chunks: number } {
    return { chunks: this.store.count() }
  }

  clear(): void {
    this.store.clear()
  }
}

// ---- Factory helpers ----

function isLLMProvider(obj: unknown): obj is LLMProvider {
  return typeof obj === 'object' && obj !== null && 'chat' in obj && typeof (obj as LLMProvider).chat === 'function'
}

function isEmbeddingsProvider(obj: unknown): obj is EmbeddingsProvider {
  return typeof obj === 'object' && obj !== null && 'embed' in obj && typeof (obj as EmbeddingsProvider).embed === 'function'
}

function createLLM(config?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number }): LLMProvider {
  const provider = config?.provider || detectProvider()

  if (provider === 'openai') {
    return new OpenAILLM({
      apiKey: config?.apiKey,
      model: config?.model,
      baseUrl: config?.baseUrl,
      temperature: config?.temperature,
    })
  }

  throw new Error(`Unsupported LLM provider: ${provider}. Set OPENAI_API_KEY env var.`)
}

function createEmbeddings(config?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string }): EmbeddingsProvider {
  const provider = config?.provider || detectProvider()

  if (provider === 'openai') {
    return new OpenAIEmbeddings({
      apiKey: config?.apiKey,
      model: config?.model,
      baseUrl: config?.baseUrl,
    })
  }

  throw new Error(`Unsupported embeddings provider: ${provider}. Set OPENAI_API_KEY env var.`)
}

function detectProvider(): string {
  if (process.env.OPENAI_API_KEY) return 'openai'
  throw new Error(
    'No AI provider detected. Set one of: OPENAI_API_KEY. ' +
    'Or pass provider config to RagEngine.create().'
  )
}

function createChunker(config?: { type?: string; maxTokens?: number; overlap?: number } | string): Chunker {
  if (typeof config === 'string') {
    return new SlidingWindowChunker()
  }
  return new SlidingWindowChunker({
    maxTokens: config?.maxTokens,
    overlap: config?.overlap,
  })
}
