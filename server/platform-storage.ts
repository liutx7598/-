import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function ensureDirectory(directory: string) {
  await mkdir(directory, { recursive: true })
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await ensureDirectory(path.dirname(filePath))
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

export class JsonStore<T> {
  private readonly filePath: string

  private readonly fallback: T

  constructor(filePath: string, fallback: T) {
    this.filePath = filePath
    this.fallback = fallback
  }

  async load() {
    return (await readJsonFile<T>(this.filePath)) ?? this.fallback
  }

  async save(payload: T) {
    await writeJsonFile(this.filePath, payload)
    return payload
  }
}
