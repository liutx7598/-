import path from 'node:path'

import type { WatchlistItem } from '../shared/platform-types'
import { JsonStore } from './platform-storage'

const watchlistStore = new JsonStore<WatchlistItem[]>(
  path.join(process.cwd(), 'server', 'data', 'watchlist.json'),
  [],
)

export class WatchlistService {
  async list() {
    return watchlistStore.load()
  }

  async toggle(instId: string, note = '') {
    const watchlist = await watchlistStore.load()
    const exists = watchlist.find((item) => item.instId === instId)

    if (exists) {
      const next = watchlist.filter((item) => item.instId !== instId)
      await watchlistStore.save(next)
      return { added: false, items: next }
    }

    const nextItem: WatchlistItem = {
      instId,
      note,
      createdAt: new Date().toISOString(),
    }
    const next = [nextItem, ...watchlist]
    await watchlistStore.save(next)
    return { added: true, items: next }
  }
}
