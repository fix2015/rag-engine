export const RELEVANCE_JUDGE_SYSTEM = `You are a relevance judge. Given a user question and retrieved document chunks, evaluate how well the chunks answer the question.

Return a JSON object with these fields:
- "score": a number from 0.0 to 1.0 (0 = completely irrelevant, 1 = perfectly answers the question)
- "decision": one of "synthesize", "rewrite", "broaden", or "give_up"
  - "synthesize": score >= 0.5, at least some chunks can help answer the question
  - "rewrite": score 0.2-0.5, chunks are related but miss the specific answer, try a more targeted query
  - "broaden": fewer than 3 relevant chunks found, try a broader query
  - "give_up": score < 0.2, chunks are completely irrelevant to the question
- "reasoning": brief explanation of your judgment
- "rewrittenQuery": (only for rewrite/broaden) a better search query to try

IMPORTANT scoring rules:
- Score based on the BEST matching chunks, not the average across all chunks.
- If even 1-2 chunks directly answer or strongly relate to the question, score >= 0.6.
- Only score below 0.3 if NO chunks contain relevant information.
- A score of 0.5+ means there's enough to attempt an answer.

IMPORTANT rewrite rules:
- When rewriting, make the query MORE SPECIFIC to match the vocabulary used in the chunks.
- Look at the actual words and terms in the chunks and use them in the rewritten query.
- Example: if chunks mention "JWT" and "authMiddleware", rewrite to include those exact terms.
- Do NOT make the query more generic, academic, or abstract.
- Good rewrite: "How does authentication work?" → "JWT token authentication authMiddleware login flow"
- Bad rewrite: "How does authentication work?" → "What are the different methods of authentication?"

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`

export const RELEVANCE_JUDGE_USER = (question: string, chunks: string) =>
  `Question: ${question}\n\nRetrieved chunks:\n${chunks}`

export const SYNTHESIZE_SYSTEM = `Answer the user's question using ONLY the provided context chunks. Rules:
- Base your answer strictly on the provided chunks
- If a chunk supports your answer, cite it as [source: chunk_id]
- If the chunks don't contain enough information, say so honestly
- Be concise and direct
- Do not make up information not present in the chunks`

export const SYNTHESIZE_USER = (question: string, chunks: string) =>
  `Question: ${question}\n\nContext chunks:\n${chunks}`

export function formatChunksForPrompt(chunks: { id: string; content: string; score: number }[]): string {
  return chunks
    .map((c, i) => `[Chunk ${i + 1} | id: ${c.id} | score: ${c.score.toFixed(2)}]\n${c.content}`)
    .join('\n\n---\n\n')
}
