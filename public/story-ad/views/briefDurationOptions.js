export const BRIEF_DURATION_OPTIONS = Object.freeze([15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600]);

export function durationLabel(seconds = 30) {
  const value = Number(seconds || 30) || 30;
  if (value % 60 === 0) return `${value / 60} 分钟`;
  if (value > 60) return `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
  return `${value} 秒`;
}

export function durationOptionsMarkup(current = 30) {
  const selected = Number(current || 30) || 30;
  return BRIEF_DURATION_OPTIONS
    .map(value => `<option value="${value}"${value === selected ? ' selected' : ''}>${durationLabel(value)}</option>`)
    .join('');
}
