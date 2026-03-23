export function formatPrice(value: number) {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  if (Math.abs(value) >= 1) {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value)
  }

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value)
}

export function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 100) / 10
  return `${seconds}s`
}
