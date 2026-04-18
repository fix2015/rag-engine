import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

export interface LoadedDocument {
  content: string
  filePath: string
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.js', '.tsx', '.jsx', '.py', '.rs', '.go',
  '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.html', '.json',
  '.yaml', '.yml', '.toml', '.xml', '.csv', '.sql', '.sh', '.bash',
  '.env', '.conf', '.cfg', '.ini', '.log', '.mdx', '.rst', '.tex',
])

export function loadDirectory(dirPath: string, glob?: string): LoadedDocument[] {
  const docs: LoadedDocument[] = []
  const pattern = glob ? new RegExp(globToRegex(glob)) : null

  function walk(dir: string) {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const full = join(dir, entry)
      const stat = statSync(full)

      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
        walk(full)
      } else if (stat.isFile()) {
        const rel = relative(dirPath, full)

        if (pattern && !pattern.test(rel)) continue
        if (!pattern && !TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) continue

        try {
          const content = readFileSync(full, 'utf-8')
          if (content.trim().length > 0) {
            docs.push({ content, filePath: rel })
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  walk(dirPath)
  return docs
}

export function loadFile(filePath: string): LoadedDocument {
  const content = readFileSync(filePath, 'utf-8')
  return { content, filePath }
}

function globToRegex(glob: string): string {
  return glob
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*')
    .replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(',').join('|')})`)
}
