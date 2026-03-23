export function normalizeBaseSymbol(instId: string, baseCcy: string) {
  const normalized = (baseCcy || instId.split('-')[0] || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()

  return normalized
}
