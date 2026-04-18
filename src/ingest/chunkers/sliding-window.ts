import type { Chunker, TextChunk, ChunkMetadata } from '../../types.js'

export class SlidingWindowChunker implements Chunker {
  private maxTokens: number
  private overlap: number

  constructor(options: { maxTokens?: number; overlap?: number } = {}) {
    this.maxTokens = options.maxTokens || 512
    this.overlap = options.overlap || 50
  }

  chunk(text: string, metadata?: Partial<ChunkMetadata>): TextChunk[] {
    const sentences = this.splitSentences(text)
    const chunks: TextChunk[] = []
    let current: string[] = []
    let currentTokens = 0
    let chunkIndex = 0

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence)

      if (currentTokens + sentenceTokens > this.maxTokens && current.length > 0) {
        chunks.push({
          content: current.join(' '),
          metadata: { ...metadata, index: chunkIndex },
        })
        chunkIndex++

        // Keep overlap
        const overlapSentences: string[] = []
        let overlapTokens = 0
        for (let i = current.length - 1; i >= 0; i--) {
          const t = this.estimateTokens(current[i])
          if (overlapTokens + t > this.overlap) break
          overlapSentences.unshift(current[i])
          overlapTokens += t
        }
        current = overlapSentences
        currentTokens = overlapTokens
      }

      current.push(sentence)
      currentTokens += sentenceTokens
    }

    if (current.length > 0) {
      chunks.push({
        content: current.join(' '),
        metadata: { ...metadata, index: chunkIndex },
      })
    }

    return chunks
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
}
