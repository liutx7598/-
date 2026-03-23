import type { MarketCapSnapshot } from '../shared/platform-types'
import { normalizeBaseSymbol } from './symbol-mapper'

interface CoinGeckoMarketRow {
  symbol: string
  market_cap: number | null
  market_cap_rank: number | null
  circulating_supply: number | null
}

const CACHE_TTL_MS = 30 * 60 * 1000

export class MarketCapProvider {
  private cache = new Map<string, MarketCapSnapshot>()

  private lastLoadedAt = 0

  private loadingTask: Promise<void> | null = null

  private async refreshCache() {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false',
      {
        headers: {
          Accept: 'application/json',
        'User-Agent': 'gate-pattern-screener/1.0',
        },
      },
    )

    if (!response.ok) {
      throw new Error(`CoinGecko HTTP ${response.status}`)
    }

    const rows = (await response.json()) as CoinGeckoMarketRow[]
    const nextCache = new Map<string, MarketCapSnapshot>()
    const updatedAt = new Date().toISOString()

    for (const row of rows) {
      nextCache.set(row.symbol.toLowerCase(), {
        marketCap: row.market_cap,
        marketCapRank: row.market_cap_rank,
        circulatingSupply: row.circulating_supply,
        source: 'coingecko',
        degraded: false,
        updatedAt,
      })
    }

    this.cache = nextCache
    this.lastLoadedAt = Date.now()
  }

  private async ensureCache() {
    if (Date.now() - this.lastLoadedAt < CACHE_TTL_MS && this.cache.size > 0) {
      return
    }

    if (!this.loadingTask) {
      this.loadingTask = this.refreshCache().finally(() => {
        this.loadingTask = null
      })
    }

    try {
      await this.loadingTask
    } catch {
      if (this.cache.size === 0) {
        throw new Error('Market cap cache unavailable')
      }
    }
  }

  async getSnapshot(instId: string, baseCcy: string): Promise<MarketCapSnapshot> {
    const symbol = normalizeBaseSymbol(instId, baseCcy)

    try {
      await this.ensureCache()
      return (
        this.cache.get(symbol) ?? {
          marketCap: null,
          marketCapRank: null,
          circulatingSupply: null,
          source: null,
          degraded: false,
          updatedAt: null,
        }
      )
    } catch {
      return {
        marketCap: null,
        marketCapRank: null,
        circulatingSupply: null,
        source: 'coingecko',
        degraded: true,
        updatedAt: null,
      }
    }
  }
}
