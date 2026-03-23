import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import cors from 'cors'
import express from 'express'

import { TIMEFRAME_MAP, type TimeframeKey } from '../shared/timeframes'
import { loadLocalEnv } from './env'
import { ScreenerService } from './service'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDirectory = path.resolve(__dirname, '..')
const distDirectory = path.join(rootDirectory, 'dist')
const indexHtmlPath = path.join(distDirectory, 'index.html')

async function main() {
  loadLocalEnv()
  const service = await new ScreenerService().init()
  const app = express()
  const port = Number(process.env.PORT ?? 8787)

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true })
  })

  app.get('/api/snapshot', (_request, response) => {
    response.json(service.getSnapshot())
  })

  app.get('/api/results', (request, response) => {
    response.json(
      service.getResults({
        page: Number(request.query.page ?? 1),
        pageSize: Number(request.query.pageSize ?? 25),
        keyword: typeof request.query.keyword === 'string' ? request.query.keyword : '',
        bars: typeof request.query.bars === 'string' ? request.query.bars : '',
        onlyMatched:
          request.query.onlyMatched === undefined
            ? true
            : String(request.query.onlyMatched) !== 'false',
        sortBy:
          typeof request.query.sortBy === 'string'
            ? (request.query.sortBy as Parameters<
                ScreenerService['getResults']
              >[0]['sortBy'])
            : undefined,
        sortOrder:
          typeof request.query.sortOrder === 'string'
            ? (request.query.sortOrder as 'asc' | 'desc')
            : 'asc',
      }),
    )
  })

  app.get('/api/chart/:instId', async (request, response) => {
    const bar =
      typeof request.query.bar === 'string' && request.query.bar in TIMEFRAME_MAP
        ? (request.query.bar as TimeframeKey)
        : '15m'
    const limit = Number(request.query.limit ?? 80)

    response.json(await service.getChart(request.params.instId, bar, limit))
  })

  app.get('/api/config', (_request, response) => {
    response.json(service.getConfig())
  })

  app.get('/api/settings', (_request, response) => {
    response.json(service.getConfig())
  })

  app.put('/api/config', async (request, response) => {
    const snapshot = await service.updateConfig(request.body ?? {})
    response.json(snapshot)
  })

  app.put('/api/settings', async (request, response) => {
    const snapshot = await service.updateConfig(request.body ?? {})
    response.json(snapshot)
  })

  app.post('/api/refresh', async (_request, response) => {
    const snapshot = await service.run('manual')
    response.json(snapshot)
  })

  app.post('/api/scan/run', async (_request, response) => {
    const snapshot = await service.run('manual')
    response.json(snapshot)
  })

  app.post('/api/monitor/toggle', async (request, response) => {
    const enabled = Boolean(request.body?.enabled)
    const snapshot = await service.toggleMonitor(enabled)
    response.json(snapshot)
  })

  app.get('/api/alerts', (_request, response) => {
    response.json(service.getAlerts())
  })

  app.get('/api/strategy-presets', async (_request, response) => {
    response.json(await service.getStrategyPresets())
  })

  app.put('/api/strategy-presets', async (request, response) => {
    response.json(await service.saveStrategyPreset(request.body ?? {}))
  })

  app.get('/api/watchlist', async (_request, response) => {
    response.json(await service.getWatchlist())
  })

  app.get('/api/llm-history', async (request, response) => {
    response.json(
      await service.getLlmHistory({
        type:
          typeof request.query.type === 'string' &&
          ['all', 'overview', 'signal'].includes(request.query.type)
            ? (request.query.type as 'all' | 'overview' | 'signal')
            : 'all',
        keyword:
          typeof request.query.keyword === 'string' ? request.query.keyword : '',
        limit: Number(request.query.limit ?? 100),
      }),
    )
  })

  app.post('/api/watchlist/toggle', async (request, response) => {
    response.json(
      await service.toggleWatchlist(
        String(request.body?.instId ?? ''),
        String(request.body?.note ?? ''),
      ),
    )
  })

  app.post('/api/alerts/test', async (_request, response) => {
    try {
      await service.testWebhook()
      response.json({ ok: true })
    } catch (error) {
      response.status(400).json({
        ok: false,
        message: error instanceof Error ? error.message : '测试提醒发送失败。',
      })
    }
  })

  if (existsSync(indexHtmlPath)) {
    app.use(express.static(distDirectory))
    app.use((request, response, next) => {
      if (request.path.startsWith('/api')) {
        next()
        return
      }

      response.sendFile(indexHtmlPath)
    })
  }

  app.listen(port, () => {
    console.log(`Gate screener listening on http://localhost:${port}`)
  })
}

void main()
