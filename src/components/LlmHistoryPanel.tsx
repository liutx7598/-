import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Bot, RefreshCcw } from 'lucide-react'

import { fetchLlmHistory } from '../api'
import { formatDateTime } from '../lib/format'
import type { LlmHistoryItem, LlmHistoryResponse } from '../../shared/types'

type HistoryFilterType = 'all' | 'overview' | 'signal'

function getHistoryTypeLabel(type: LlmHistoryItem['type']) {
  return type === 'overview' ? '首页总览' : '单币信号'
}

export function LlmHistoryPanel() {
  const [historyType, setHistoryType] = useState<HistoryFilterType>('all')
  const [keyword, setKeyword] = useState('')
  const [refreshSeed, setRefreshSeed] = useState(0)
  const [historyResponse, setHistoryResponse] = useState<LlmHistoryResponse | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deferredKeyword = useDeferredValue(keyword.trim())
  const selectedItem = useMemo(
    () =>
      historyResponse?.items.find((item) => item.id === selectedHistoryId) ??
      historyResponse?.items[0] ??
      null,
    [historyResponse, selectedHistoryId],
  )

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        setIsLoading(true)
        setError(null)

        const nextHistory = await fetchLlmHistory({
          type: historyType,
          keyword: deferredKeyword,
          limit: 120,
        })

        if (cancelled) {
          return
        }

        setHistoryResponse(nextHistory)
        setSelectedHistoryId((current) =>
          nextHistory.items.some((item) => item.id === current)
            ? current
            : nextHistory.items[0]?.id ?? null,
        )
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '加载历史分析失败')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [deferredKeyword, historyType, refreshSeed])

  return (
    <section className="history-panel">
      <div className="history-hero">
        <div>
          <p className="eyebrow">LLM History</p>
          <h2>历史 AI 分析记录</h2>
          <p className="history-subtitle">
            这里集中展示已经落盘保存的 Qwen / LLM 历史分析，包括首页 15 分钟总览和单个币种的信号摘要。
            不需要再翻文件夹，直接在页面里按类型和关键词查看即可。
          </p>
        </div>

        <div className="history-hero-stats">
          <span className="summary-chip">记录数 {historyResponse?.total ?? 0}</span>
          <span className="summary-chip">当前类型 {historyType}</span>
          <span className="summary-chip">{isLoading ? '同步中' : '已同步'}</span>
        </div>
      </div>

      <div className="history-toolbar">
        <label className="field" htmlFor="history-type">
          <span>记录类型</span>
          <select
            id="history-type"
            name="history_type"
            value={historyType}
            onChange={(event) => setHistoryType(event.target.value as HistoryFilterType)}
          >
            <option value="all">全部</option>
            <option value="overview">首页总览</option>
            <option value="signal">单币信号</option>
          </select>
        </label>

        <label className="field" htmlFor="history-keyword">
          <span>关键词</span>
          <input
            id="history-keyword"
            name="history_keyword"
            type="search"
            value={keyword}
            placeholder="搜索币种、周期、摘要或 signalKey"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>

        <button
          className="secondary-button"
          type="button"
          onClick={() => setRefreshSeed((current) => current + 1)}
          disabled={isLoading}
        >
          <RefreshCcw size={16} />
          刷新历史
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="history-layout">
        <aside className="history-list">
          {historyResponse?.items.length ? (
            historyResponse.items.map((item) => (
              <button
                key={item.id}
                className={
                  item.id === selectedItem?.id
                    ? 'history-list-item history-list-item-active'
                    : 'history-list-item'
                }
                type="button"
                onClick={() => setSelectedHistoryId(item.id)}
              >
                <div className="history-list-head">
                  <strong>{item.title}</strong>
                  <span className="history-type-tag">{getHistoryTypeLabel(item.type)}</span>
                </div>
                <small>{item.generatedAt ? formatDateTime(item.generatedAt) : '未知时间'}</small>
                <p>{item.summary || '这条历史记录没有可展示的摘要内容。'}</p>
              </button>
            ))
          ) : (
            <div className="history-empty">
              {isLoading ? '正在读取历史分析...' : '当前筛选条件下还没有历史分析记录。'}
            </div>
          )}
        </aside>

        <article className="history-detail">
          {selectedItem ? (
            <>
              <div className="history-detail-header">
                <div>
                  <p className="eyebrow">History Detail</p>
                  <h3>{selectedItem.title}</h3>
                </div>
                <span className="summary-chip">
                  <Bot size={14} />
                  {selectedItem.model ?? 'unknown model'}
                </span>
              </div>

              <div className="history-detail-meta">
                <span className="summary-chip">
                  生成时间 {selectedItem.generatedAt ? formatDateTime(selectedItem.generatedAt) : '未知'}
                </span>
                {selectedItem.instId ? (
                  <span className="summary-chip">币种 {selectedItem.instId}</span>
                ) : null}
                {selectedItem.timeframeLabel ? (
                  <span className="summary-chip">周期 {selectedItem.timeframeLabel}</span>
                ) : null}
                {selectedItem.leadingTimeframeLabel ? (
                  <span className="summary-chip">主导周期 {selectedItem.leadingTimeframeLabel}</span>
                ) : null}
                {selectedItem.totalMatches !== null ? (
                  <span className="summary-chip">命中 {selectedItem.totalMatches}</span>
                ) : null}
                {selectedItem.newMatches !== null ? (
                  <span className="summary-chip">新增 {selectedItem.newMatches}</span>
                ) : null}
                {selectedItem.removedMatches !== null ? (
                  <span className="summary-chip">消失 {selectedItem.removedMatches}</span>
                ) : null}
              </div>

              <div className="history-summary-card">
                <p>{selectedItem.summary || '这条记录没有摘要，下方保留了完整 Markdown 文本。'}</p>
              </div>

              <pre className="history-markdown">{selectedItem.markdown}</pre>
            </>
          ) : (
            <div className="history-empty">请选择左侧一条历史记录查看详情。</div>
          )}
        </article>
      </div>
    </section>
  )
}
