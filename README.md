# rag-engine

> Agentic RAG framework for Node.js — zero runtime dependencies, auto-retries with query rewriting, full decision trace.

[![npm version](https://img.shields.io/npm/v/rag-engine.svg)](https://www.npmjs.com/package/rag-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Not basic RAG. **Agentic RAG.** The agent decides when to search, when to rewrite the query, when to retry, and when to give up honestly.

## 5-Line Quickstart

```javascript
import { RagEngine } from 'rag-engine'

const rag = await RagEngine.create()
await rag.ingest('./docs')
const result = await rag.query('How does auth work?')
console.log(result.answer)
```

## Why Not LangChain?

| | rag-engine | LangChain |
|---|---|---|
| Dependencies | **0** runtime deps | 200+ |
| Bundle size | ~50KB | ~5MB |
| Agent retries | Built-in | Manual |
| Decision trace | Every query | No |
| Setup | 5 lines | 50+ lines |

## How the Agent Thinks

After every retrieval, an LLM judge evaluates if the chunks answer the question:

| Decision | When | What happens |
|----------|------|-------------|
| **SYNTHESIZE** | Relevance >= 0.7 | Chunks are good, generate answer |
| **REWRITE** | Relevance 0.3-0.7 | Chunks are off-topic, rewrite query and retry |
| **BROADEN** | < 3 results | Too few results, broaden query |
| **GIVE_UP** | Max retries or relevance < 0.3 | Honestly say "I don't know" |

## Install

```bash
npm install rag-engine
```

## Usage

### Basic

```javascript
import { RagEngine } from 'rag-engine'

const rag = await RagEngine.create()       // auto-detects OPENAI_API_KEY
await rag.ingest('./docs')                 // loads, chunks, embeds
const result = await rag.query('How does auth work?')

console.log(result.answer)                 // answer with citations
console.log(result.sources)                // relevant chunks with scores
console.log(result.trace)                  // full agent decision trace
console.log(result.metrics)                // timing, LLM calls
```

### Custom Config

```javascript
const rag = await RagEngine.create({
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.1,
  },
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-3-small',
  },
  agent: {
    maxRetries: 3,
    relevanceThreshold: 0.7,
  },
  chunker: {
    maxTokens: 512,
    overlap: 50,
  },
  retrieval: {
    topK: 10,
  },
})
```

### Ingest Files

```javascript
await rag.ingest('./docs')                           // all text files
await rag.ingest('./src', { glob: '**/*.ts' })       // TypeScript only
await rag.ingest('./README.md')                      // single file
await rag.ingest('Raw text content to index')        // raw string
```

### Query Response

```javascript
const result = await rag.query('What is the refund policy?')

// result.answer: "The refund policy allows returns within 30 days..."
// result.sources: [{ id: "policy.md:3", content: "...", score: 0.92, metadata: {...} }]
// result.trace: [
//   { action: "search", query: "What is the refund policy?", resultsCount: 5 },
//   { action: "evaluate", score: 0.89, decision: "synthesize" },
//   { action: "synthesize" }
// ]
// result.metrics: { totalTimeMs: 2340, retrievalTimeMs: 180, llmCalls: 2 }
```

### Express.js API

```javascript
import express from 'express'
import { RagEngine } from 'rag-engine'

const app = express()
const rag = await RagEngine.create()
await rag.ingest('./docs')

app.use(express.json())
app.post('/ask', async (req, res) => {
  const result = await rag.query(req.body.question)
  res.json(result)
})
app.listen(3000)
```

## CLI

```bash
npx rag-engine ingest ./docs
npx rag-engine ingest ./src --glob "**/*.ts"
npx rag-engine query "How does authentication work?"
npx rag-engine stats
```

## Environment

```
OPENAI_API_KEY=sk-...    # Required for OpenAI LLM + embeddings
```

## Architecture

```
src/
  core/engine.ts       RagEngine class — wires everything together
  core/agent.ts        Agentic loop (retrieve → judge → decide → retry/answer)
  llm/openai.ts        OpenAI LLM + embeddings via native fetch()
  llm/prompts.ts       All agent prompts (judge, synthesizer)
  stores/memory.ts     In-memory vector store (Map + cosine similarity)
  ingest/loader.ts     File/directory loader
  ingest/chunkers/     Sliding-window chunker
```

## Roadmap

- [ ] Ollama provider (free local RAG)
- [ ] Anthropic + Gemini providers
- [ ] Streaming responses
- [ ] SQLite vector store
- [ ] Markdown + code-aware chunkers
- [ ] Hybrid retrieval (vector + BM25)
- [ ] Plugin system
- [ ] Built-in evaluation
- [ ] `npx rag-engine serve` (HTTP API)

## License

MIT
