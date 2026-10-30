import test from 'node:test';
import assert from 'node:assert/strict';
import { sortModelRanking } from '../src/model-ranking.mjs';

const rows = [
  { model: 'glm-5', quota: 2, count: 1, tokens: 300 },
  { model: 'deepseek-2', quota: 4, count: 3, tokens: 100 },
  { model: 'kimi-1', quota: 4, count: 2, tokens: 200 },
];

test('ranking sorts credits descending without mutating source', () => {
  assert.deepEqual(sortModelRanking(rows).map(row => row.model), ['deepseek-2', 'kimi-1', 'glm-5']);
  assert.equal(rows[0].model, 'glm-5');
});

test('each ranking field sorts both ways', () => {
  for (const field of ['count', 'quota', 'tokens', 'model']) {
    const ascending = sortModelRanking(rows, field, 'asc');
    const descending = sortModelRanking(rows, field, 'desc');
    assert.equal(ascending.length, rows.length);
    assert.equal(descending.length, rows.length);
    if (field === 'model') {
      assert.deepEqual(ascending.map(row => row.model), [...descending].reverse().map(row => row.model));
    } else {
      assert.deepEqual(ascending.map(row => row[field]), [...descending].reverse().map(row => row[field]));
    }
  }
});
