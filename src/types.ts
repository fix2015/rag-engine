export interface RagConfig {
  llm?: LLMConfig | LLMProvider
  embeddings?: EmbeddingsConfig | EmbeddingsProvider
  store?: VectorStore
  chunker?: ChunkerConfig | string
  agent?: AgentConfig
  retrieval?: RetrievalConfig
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'gemini'
  model?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
}

export interface EmbeddingsConfig {
  provider: 'openai' | 'ollama'
  model?: string
  apiKey?: string
  baseUrl?: string
}

export interface AgentConfig {
  maxRetries?: number
  relevanceThreshold?: number
  systemPrompt?: string
}

export interface RetrievalConfig {
  topK?: number
  method?: 'vector' | 'hybrid'
}

export interface ChunkerConfig {
  type?: 'sliding-window' | 'markdown' | 'code'
  maxTokens?: number
  overlap?: number
}

export interface LLMProvider {
  chat(messages: ChatMessage[], options?: LLMCallOptions): Promise<string>
  chatJSON<T = unknown>(messages: ChatMessage[], options?: LLMCallOptions): Promise<T>
}

export interface EmbeddingsProvider {
  embed(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
}

export interface VectorStore {
  add(chunks: Chunk[]): Promise<void>
  search(embedding: number[], topK: number): Promise<ScoredChunk[]>
  count(): number
  clear(): void
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMCallOptions {
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
}

export interface Chunk {
  id: string
  content: string
  embedding: number[]
  metadata: ChunkMetadata
}

export interface ChunkMetadata {
  file?: string
  index?: number
  startLine?: number
  endLine?: number
  [key: string]: unknown
}

export interface ScoredChunk {
  id: string
  content: string
  score: number
  metadata: ChunkMetadata
}

export interface IngestOptions {
  glob?: string
}

export interface QueryResult {
  answer: string
  sources: ScoredChunk[]
  trace: TraceEntry[]
  metrics: QueryMetrics
}

export interface TraceEntry {
  action: 'search' | 'evaluate' | 'rewrite' | 'broaden' | 'synthesize' | 'give_up'
  timestamp: number
  query?: string
  resultsCount?: number
  attempt?: number
  score?: number
  decision?: string
  reasoning?: string
  newQuery?: string
}

export interface QueryMetrics {
  totalTimeMs: number
  retrievalTimeMs: number
  llmCalls: number
  tokensUsed: number
}

export interface RelevanceJudgment {
  score: number
  decision: 'synthesize' | 'rewrite' | 'broaden' | 'give_up'
  reasoning: string
  rewrittenQuery?: string
}

export interface Chunker {
  chunk(text: string, metadata?: Partial<ChunkMetadata>): TextChunk[]
}

export interface TextChunk {
  content: string
  metadata: ChunkMetadata
}
