import { db } from './db.mjs';
import { scoreSetupRanking } from '../shared/setup-ranking.mjs';

let cached;
let pending;

export async function setupRanking() {
  if (cached && Date.now() < cached.expires) return cached.data;
  if (pending) return pending;
  pending = (async () => {
    const result = await db.query({ text: `
      SELECT regexp_replace(model_name, '^cn:', '') AS model, count(*) AS requests, sum(quota) AS quota,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY
          NULLIF(substring(other FROM '"frt"[[:space:]]*:[[:space:]]*([0-9]+(?:[.][0-9]+)?)')::double precision, 0)
        ) AS first_response_ms
      FROM logs
      WHERE type=2 AND created_at >= $1 AND model_name <> ''
        AND channel_id IN (SELECT id FROM channels WHERE name='WorkBuddy')
      GROUP BY 1 ORDER BY sum(quota) DESC, count(*) DESC, 1 LIMIT 200`,
      values: [Math.floor(Date.now() / 1000) - 7 * 86400], query_timeout: 5000,
    });
    const data = { models: scoreSetupRanking(result.rows), days: 7, updated_at: new Date().toISOString(), source: 'NewAPI 成功调用日志 · 按积分消耗排名；速度为首响中位数' };
    cached = { data, expires: Date.now() + 60000 };
    return data;
  })();
  try { return await pending; } finally { pending = undefined; }
}
