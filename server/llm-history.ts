import { access } from 'node:fs/promises'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getLlmEnvConfig } from './env'
import type { RuntimeState } from './storage'
import type { TimeframeKey } from '../shared/timeframes'
import type { AiOverview, LlmHistoryItem, LlmHistoryResponse } from '../shared/types'

interface SignalHistoryInput {
  signalKey: string
  instId: string
  timeframe: TimeframeKey | string
  timeframeLabel: string
}

const historyRootDirectory = path.join(process.cwd(), 'server', 'data', 'llm-history')
const signalHistoryDirectory = path.join(historyRootDirectory, 'signals')
const overviewHistoryDirectory = path.join(historyRootDirectory, 'overview')

type LlmHistoryDirectoryType = 'overview' | 'signal'

function resolveHistoryDirectory(
  type: LlmHistoryDirectoryType,
  rootDirectory = historyRootDirectory,
) {
  return path.join(rootDirectory, type === 'overview' ? 'overview' : 'signals')
}

function sanitizeFileSegment(value: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')

  return sanitized.slice(0, 120) || 'unknown'
}

export function buildHistoryTimestamp(value: string | number | Date | null | undefined) {
  const date = value ? new Date(value) : new Date()
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const parts = [
    safeDate.getFullYear().toString().padStart(4, '0'),
    (safeDate.getMonth() + 1).toString().padStart(2, '0'),
    safeDate.getDate().toString().padStart(2, '0'),
    '-',
    safeDate.getHours().toString().padStart(2, '0'),
    safeDate.getMinutes().toString().padStart(2, '0'),
    safeDate.getSeconds().toString().padStart(2, '0'),
    '-',
    safeDate.getMilliseconds().toString().padStart(3, '0'),
  ]

  return parts.join('')
}

function parseSignalKey(signalKey: string) {
  const segments = signalKey.split(':')

  if (segments.length < 3) {
    return {
      instId: signalKey,
      timeframe: 'unknown',
      lastClosedTs: 'unknown',
    }
  }

  const lastClosedTs = segments.pop() ?? 'unknown'
  const timeframe = segments.pop() ?? 'unknown'
  const instId = segments.join(':') || signalKey

  return {
    instId,
    timeframe,
    lastClosedTs,
  }
}

export function buildSignalHistoryBaseName(signalKey: string, analyzedAt: string) {
  const parsed = parseSignalKey(signalKey)

  return [
    buildHistoryTimestamp(analyzedAt),
    'signal',
    sanitizeFileSegment(parsed.instId),
    sanitizeFileSegment(parsed.timeframe),
    sanitizeFileSegment(parsed.lastClosedTs),
  ].join('__')
}

export function buildOverviewHistoryBaseName(overview: AiOverview) {
  return [
    buildHistoryTimestamp(overview.generatedAt ?? overview.basedOnRunAt),
    'overview',
    sanitizeFileSegment(overview.status),
    sanitizeFileSegment(overview.leadingTimeframeLabel ?? 'none'),
    sanitizeFileSegment(String(overview.totalMatches)),
  ].join('__')
}

async function ensureDirectory(directory: string) {
  await mkdir(directory, { recursive: true })
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeHistoryPair(
  directory: string,
  baseName: string,
  payload: unknown,
  markdown: string,
) {
  await ensureDirectory(directory)
  await writeFile(
    path.join(directory, `${baseName}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf-8',
  )
  await writeFile(path.join(directory, `${baseName}.md`), `${markdown.trim()}\n`, 'utf-8')
}

function buildSignalMarkdown(
  input: SignalHistoryInput,
  summary: string,
  analyzedAt: string,
  model: string,
) {
  return `
# LLM 信号分析记录

- 生成时间: ${analyzedAt}
- 币种: ${input.instId}
- 周期: ${input.timeframeLabel}
- signalKey: ${input.signalKey}
- 模型: ${model}

## 摘要

${summary}
`
}

function buildOverviewMarkdown(overview: AiOverview, model: string) {
  const timeframeLines =
    overview.timeframeStats.length > 0
      ? overview.timeframeStats.map((item) => `- ${item.label}: ${item.count}`).join('\n')
      : '- 暂无'
  const signalLines =
    overview.sampleSignals.length > 0
      ? overview.sampleSignals
          .map((item) => `- ${item.instId} · ${item.timeframeLabel}`)
          .join('\n')
      : '- 暂无'

  return `
# LLM 首页总览记录

- 状态: ${overview.status}
- 来源: ${overview.source}
- 生成时间: ${overview.generatedAt ?? '未生成'}
- 基于扫描时间: ${overview.basedOnRunAt ?? '未知'}
- 模型: ${model}
- 命中数: ${overview.totalMatches}
- 新增数: ${overview.newMatches}
- 移除数: ${overview.removedMatches}
- 主导周期: ${overview.leadingTimeframeLabel ?? '暂无'}
- 错误: ${overview.error ?? '无'}

## 摘要

${overview.summary ?? '暂无'}

## 周期分布

${timeframeLines}

## 代表标的

${signalLines}
`
}

export function getLlmHistoryRootDirectory() {
  return historyRootDirectory
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildOverviewHistoryItem(
  id: string,
  payload: Record<string, unknown>,
  markdown: string,
): LlmHistoryItem {
  const summary = normalizeString(payload.summary) ?? ''
  const status = normalizeString(payload.status)
  const leadingTimeframeLabel = normalizeString(payload.leadingTimeframeLabel)

  return {
    id,
    type: 'overview',
    title: `首页总览 · ${status ?? 'unknown'}`,
    generatedAt:
      normalizeString(payload.generatedAt) ?? normalizeString(payload.basedOnRunAt),
    model: normalizeString(payload.model),
    summary,
    markdown: markdown || summary,
    status,
    source: normalizeString(payload.source),
    instId: null,
    timeframe: null,
    timeframeLabel: leadingTimeframeLabel,
    signalKey: null,
    totalMatches: normalizeNumber(payload.totalMatches),
    newMatches: normalizeNumber(payload.newMatches),
    removedMatches: normalizeNumber(payload.removedMatches),
    leadingTimeframeLabel,
  }
}

function buildSignalHistoryItem(
  id: string,
  payload: Record<string, unknown>,
  markdown: string,
): LlmHistoryItem {
  const instId = normalizeString(payload.instId)
  const timeframeLabel =
    normalizeString(payload.timeframeLabel) ?? normalizeString(payload.timeframe)
  const summary = normalizeString(payload.summary) ?? ''

  return {
    id,
    type: 'signal',
    title: `${instId ?? 'unknown'} · ${timeframeLabel ?? 'unknown'}`,
    generatedAt: normalizeString(payload.analyzedAt),
    model: normalizeString(payload.model),
    summary,
    markdown: markdown || summary,
    status: 'ready',
    source: 'llm',
    instId,
    timeframe: normalizeString(payload.timeframe),
    timeframeLabel,
    signalKey: normalizeString(payload.signalKey),
    totalMatches: null,
    newMatches: null,
    removedMatches: null,
    leadingTimeframeLabel: null,
  }
}

async function readHistoryItemsFromDirectory(
  type: LlmHistoryDirectoryType,
  rootDirectory = historyRootDirectory,
): Promise<LlmHistoryItem[]> {
  const directory = resolveHistoryDirectory(type, rootDirectory)

  await ensureDirectory(directory)

  const files = (await readdir(directory))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort((left, right) => right.localeCompare(left))

  const items = await Promise.all(
    files.map(async (fileName) => {
      const baseName = fileName.replace(/\.json$/i, '')
      const jsonPath = path.join(directory, fileName)
      const markdownPath = path.join(directory, `${baseName}.md`)

      try {
        const jsonContent = await readFile(jsonPath, 'utf-8')
        const payload = JSON.parse(jsonContent) as Record<string, unknown>
        const markdown = (await fileExists(markdownPath))
          ? await readFile(markdownPath, 'utf-8')
          : ''

        if (type === 'overview') {
          return buildOverviewHistoryItem(baseName, payload, markdown)
        }

        return buildSignalHistoryItem(baseName, payload, markdown)
      } catch (error) {
        console.warn(
          `[LLM history] Failed to read ${jsonPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return null
      }
    }),
  )

  return items.filter((item): item is LlmHistoryItem => item !== null)
}

export async function listLlmHistory(options?: {
  type?: LlmHistoryDirectoryType | 'all'
  keyword?: string
  limit?: number
  rootDirectory?: string
}): Promise<LlmHistoryResponse> {
  const type = options?.type ?? 'all'
  const keyword = (options?.keyword ?? '').trim().toLowerCase()
  const limit = Math.min(200, Math.max(1, Number(options?.limit ?? 100)))
  const sourceTypes =
    type === 'all' ? (['overview', 'signal'] as const) : ([type] as const)

  const nestedItems = await Promise.all(
    sourceTypes.map((directoryType) =>
      readHistoryItemsFromDirectory(directoryType, options?.rootDirectory),
    ),
  )

  let items = nestedItems.flat().sort((left, right) => {
    const leftTime = left.generatedAt ? Date.parse(left.generatedAt) : 0
    const rightTime = right.generatedAt ? Date.parse(right.generatedAt) : 0

    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }

    return right.id.localeCompare(left.id)
  })

  if (keyword) {
    items = items.filter((item) =>
      [
        item.title,
        item.summary,
        item.instId,
        item.timeframeLabel,
        item.leadingTimeframeLabel,
        item.signalKey,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }

  return {
    total: items.length,
    items: items.slice(0, limit),
  }
}

export async function recordSignalSummaryHistory(
  input: SignalHistoryInput,
  summary: string,
  analyzedAt: string,
) {
  const model = getLlmEnvConfig().model || 'unknown'
  const baseName = buildSignalHistoryBaseName(input.signalKey, analyzedAt)
  const payload = {
    type: 'signal',
    model,
    analyzedAt,
    ...input,
    summary,
  }

  try {
    await writeHistoryPair(
      signalHistoryDirectory,
      baseName,
      payload,
      buildSignalMarkdown(input, summary, analyzedAt, model),
    )
  } catch (error) {
    console.warn(
      `[LLM history] Failed to persist signal summary for ${input.signalKey}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export async function recordOverviewHistory(overview: AiOverview) {
  if (!overview.summary && !overview.error) {
    return
  }

  const model = getLlmEnvConfig().model || 'unknown'
  const baseName = buildOverviewHistoryBaseName(overview)
  const payload = {
    type: 'overview',
    model,
    ...overview,
  }

  try {
    await writeHistoryPair(
      overviewHistoryDirectory,
      baseName,
      payload,
      buildOverviewMarkdown(overview, model),
    )
  } catch (error) {
    console.warn(
      `[LLM history] Failed to persist home overview history: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export async function syncRuntimeStateToLlmHistory(runtime: RuntimeState) {
  const signalTasks = Object.entries(runtime.llmSummaries).map(
    async ([signalKey, record]) => {
      const parsed = parseSignalKey(signalKey)
      await recordSignalSummaryHistory(
        {
          signalKey,
          instId: parsed.instId,
          timeframe: parsed.timeframe,
          timeframeLabel: parsed.timeframe,
        },
        record.summary,
        record.analyzedAt,
      )
    },
  )

  await Promise.all(signalTasks)

  if (runtime.homeAiOverview) {
    await recordOverviewHistory(runtime.homeAiOverview)
  }
}
