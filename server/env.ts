import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

let loaded = false

function unquote(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function applyEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return
  }

  const content = readFileSync(filePath, 'utf-8')

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')

    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = unquote(line.slice(separatorIndex + 1).trim())

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

export function loadLocalEnv() {
  if (loaded) {
    return
  }

  const rootDirectory = process.cwd()
  applyEnvFile(path.join(rootDirectory, '.env'))
  applyEnvFile(path.join(rootDirectory, '.env.local'))
  loaded = true
}

function normalizeModelName(value: string | undefined, source: 'qwen' | 'fallback') {
  const normalized = value?.trim()

  if (!normalized) {
    return 'qwen3.5-plus'
  }

  if (/qwen[\s/-]*3\.5[\s/-]*plus/i.test(normalized)) {
    return 'qwen3.5-plus'
  }

  if (/qwen[\s/-]*plus/i.test(normalized)) {
    return 'qwen-plus'
  }

  if (source === 'fallback' && normalized.includes('/')) {
    return 'qwen3.5-plus'
  }

  return normalized
}

export function getLlmEnvConfig() {
  loadLocalEnv()

  const apiKey = process.env.QWEN_API_KEY?.trim() ?? ''
  const baseUrl = process.env.QWEN_BASE_URL?.trim() ?? ''
  const model = process.env.QWEN_MODEL?.trim()
    ? normalizeModelName(process.env.QWEN_MODEL, 'qwen')
    : normalizeModelName(process.env.HF_MODEL_NAME, 'fallback')

  return {
    apiKey,
    baseUrl,
    model,
    enabled: Boolean(apiKey && baseUrl && model),
  }
}
