export function sortModelRanking(rows, field = 'quota', direction = 'desc') {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const comparison = field === 'model'
      ? String(left.model || '').localeCompare(String(right.model || ''), 'zh-CN', { numeric: true })
      : (Number(left[field]) || 0) - (Number(right[field]) || 0);
    return factor * comparison || String(left.model || '').localeCompare(String(right.model || ''), 'zh-CN', { numeric: true });
  });
}
