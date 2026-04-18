import type { LLMProvider, EmbeddingsProvider, ChatMessage, LLMCallOptions } from '../types.js'

export class OpenAILLM implements LLMProvider {
  private apiKey: string
  private model: string
  private baseUrl: string
  private temperature: number
  public lastTokensUsed: number = 0

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string; temperature?: number } = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || ''
    this.model = options.model || 'gpt-4o-mini'
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1'
    this.temperature = options.temperature ?? 0.1

    if (!this.apiKey) {
      throw new Error('OpenAI API key not found. Set OPENAI_API_KEY env var or pass apiKey option.')
    }
  }

  async chat(messages: ChatMessage[], options?: LLMCallOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? this.temperature,
    }

    if (options?.maxTokens) body.max_tokens = options.maxTokens
    if (options?.jsonMode) body.response_format = { type: 'json_object' }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${error}`)
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[]
      usage?: { total_tokens: number }
    }

    this.lastTokensUsed = data.usage?.total_tokens ?? 0
    return data.choices[0].message.content
  }

  async chatJSON<T = unknown>(messages: ChatMessage[], options?: LLMCallOptions): Promise<T> {
    const raw = await this.chat(messages, { ...options, jsonMode: true })

    // Handle markdown-wrapped JSON
    let cleaned = raw.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    try {
      return JSON.parse(cleaned) as T
    } catch {
      throw new Error(`Failed to parse LLM JSON response: ${raw.substring(0, 200)}`)
    }
  }
}

export class OpenAIEmbeddings implements EmbeddingsProvider {
  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || ''
    this.model = options.model || 'text-embedding-3-small'
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1'

    if (!this.apiKey) {
      throw new Error('OpenAI API key not found. Set OPENAI_API_KEY env var or pass apiKey option.')
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI Embeddings error ${response.status}: ${error}`)
    }

    const data = await response.json() as {
      data: { embedding: number[] }[]
    }

    return data.data.map(d => d.embedding)
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text])
    return embedding
  }
}
