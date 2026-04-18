#!/usr/bin/env node

import { resolve } from 'node:path'
import { argv, exit } from 'node:process'
import { readFileSync } from 'node:fs'

// Load .env file if present
try {
  const env = readFileSync('.env', 'utf-8')
  for (const line of env.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (key && !process.env[key]) process.env[key] = val
  }
} catch { /* no .env file */ }

const args = argv.slice(2)
const command = args[0]

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(`
  rag-engine — Agentic RAG Framework for Node.js

  Usage:
    rag-engine ingest <path> [--glob <pattern>]   Ingest files into the index
    rag-engine query "<question>"                  Query the knowledge base
    rag-engine stats                               Show index stats
    rag-engine --help                              Show this help

  Examples:
    rag-engine ingest ./docs
    rag-engine ingest ./src --glob "**/*.ts"
    rag-engine query "How does authentication work?"

  Environment:
    OPENAI_API_KEY    Required for OpenAI LLM + embeddings
    Reads .env file automatically if present.

  Note: CLI uses in-memory store — documents are re-ingested on every run.
  For persistent storage, use the programmatic API (SQLite store coming soon).
`)
    return
  }

  const { RagEngine } = await import('../dist/index.js')

  if (command === 'ingest') {
    const path = args[1]
    if (!path) {
      console.error('  Error: path required. Usage: rag-engine ingest <path>')
      exit(1)
    }
    const globIdx = args.indexOf('--glob')
    const glob = globIdx !== -1 ? args[globIdx + 1] : undefined

    const rag = await RagEngine.create()
    console.log(`  Ingesting ${resolve(path)}...`)
    const result = await rag.ingest(path, glob ? { glob } : undefined)
    console.log(`  Done: ${result.filesProcessed} files, ${result.chunksAdded} chunks`)
    return
  }

  if (command === 'query') {
    const question = args[1]
    if (!question) {
      console.error('  Error: question required. Usage: rag-engine query "your question"')
      exit(1)
    }

    const rag = await RagEngine.create()

    // Check if there's a local docs folder to auto-ingest
    try {
      const { statSync } = await import('node:fs')
      if (statSync('./docs').isDirectory()) {
        console.log('  Auto-ingesting ./docs...')
        const r = await rag.ingest('./docs')
        console.log(`  Indexed ${r.chunksAdded} chunks from ${r.filesProcessed} files\n`)
      }
    } catch { /* no docs folder */ }

    console.log(`  Question: ${question}\n`)
    const result = await rag.query(question)

    console.log(`  Answer: ${result.answer}\n`)

    if (result.sources.length > 0) {
      console.log('  Sources:')
      for (const s of result.sources.slice(0, 5)) {
        console.log(`    [${s.score.toFixed(2)}] ${s.id}: ${s.content.substring(0, 80)}...`)
      }
      console.log()
    }

    console.log('  Trace:')
    for (const t of result.trace) {
      const details = t.reasoning ? ` — ${t.reasoning}` : ''
      console.log(`    ${t.action}${t.score !== undefined ? ` (${t.score.toFixed(2)})` : ''}${details}`)
    }

    console.log(`\n  Metrics: ${result.metrics.totalTimeMs}ms, ${result.metrics.llmCalls} LLM calls`)
    return
  }

  if (command === 'stats') {
    const rag = await RagEngine.create()
    console.log(`  Index: ${rag.stats().chunks} chunks`)
    return
  }

  console.error(`  Unknown command: ${command}. Run rag-engine --help`)
  exit(1)
}

main().catch(err => {
  console.error(`  Error: ${err.message}`)
  exit(1)
})
