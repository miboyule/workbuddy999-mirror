import test from 'node:test';
import assert from 'node:assert/strict';
// Pure scoring is kept separate from database connections.
import { scoreSetupRanking } from '../shared/setup-ranking.mjs';

test('setup ratings use credit ranking and measured first-response latency', () => {
  const rows = [
    { model: 'slow', quota: 2, requests: 20, first_response_ms: 12000 },
    { model: 'popular', quota: 100, requests: 3, first_response_ms: 900 },
    { model: 'unknown-speed', quota: 1, requests: 1, first_response_ms: null },
  ];
  const ranked = scoreSetupRanking(rows);
  assert.equal(ranked[0].id, 'popular');
  assert.equal(ranked[0].popularity_stars, 5);
  assert.equal(ranked[0].speed_stars, 5);
  assert.equal(ranked[1].speed_stars, 1);
  assert.equal(ranked[2].speed_stars, 0);
  assert.equal(ranked[2].latency_ms, 0);
  assert.equal(rows[0].model, 'slow');
  assert.deepEqual(scoreSetupRanking([]), []);
});
