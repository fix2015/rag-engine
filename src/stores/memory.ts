import type { VectorStore, Chunk, ScoredChunk } from '../types.js'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export class MemoryStore implements VectorStore {
  private chunks: Map<string, Chunk> = new Map()

  async add(chunks: Chunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk)
    }
  }

  async search(embedding: number[], topK: number): Promise<ScoredChunk[]> {
    const scored: ScoredChunk[] = []

    for (const chunk of this.chunks.values()) {
      const score = cosineSimilarity(embedding, chunk.embedding)
      scored.push({
        id: chunk.id,
        content: chunk.content,
        score,
        metadata: chunk.metadata,
      })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  count(): number {
    return this.chunks.size
  }

  clear(): void {
    this.chunks.clear()
  }
}
