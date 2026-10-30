export function scoreSetupRanking(rows) {
  const ordered = [...rows].sort((a, b) => Number(b.quota) - Number(a.quota) || Number(b.requests) - Number(a.requests) || a.model.localeCompare(b.model));
  return ordered.map((row, index) => {
    const latency = Number(row.first_response_ms) || 0;
    return {
      id: row.model, popularity_rank: index + 1,
      popularity_stars: Math.max(1, 5 - Math.floor(index * 5 / ordered.length)),
      latency_ms: Math.round(latency),
      speed_stars: latency > 0 ? (latency <= 1000 ? 5 : latency <= 3000 ? 4 : latency <= 6000 ? 3 : latency <= 10000 ? 2 : 1) : 0,
      sample_count: Number(row.requests), ranking_days: 7,
    };
  });
}

