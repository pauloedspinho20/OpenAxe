const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export function noteName(midi: number): string {
  if (midi < 0) return '—'
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

export function formatNumber(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))))
  return v.toFixed(decimals)
}
