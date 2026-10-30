import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaForPoints, pointsFromQuota, cnyForPoints, creditPlans, billing, redemptionPattern } from '../shared/billing.mjs';
import { modelPrices } from '../shared/model-pricing.mjs';

test('portal points use a stable NewAPI quota conversion', () => {
  assert.equal(quotaForPoints(200), 714286);
  assert.equal(quotaForPoints(1000), 3571429);
  for (const p of creditPlans) {
    assert.equal(pointsFromQuota(quotaForPoints(p.points)), p.points);
    assert.ok(Math.abs(quotaForPoints(p.points) / billing.quotaPerUsd * billing.usdExchangeRate - p.amountCny) < 0.00001);
    assert.equal(cnyForPoints(p.points), p.amountCny);
    assert.ok(redemptionPattern.test(p.prefix + '-0123456789abcdef'));
  }
  assert.equal(cnyForPoints(1000), 50);
});

test('all catalog models settle measured upstream credits instead of fixed request fees', () => {
  for (const p of modelPrices) {
    assert.equal(p.billingUnit, 'upstream_credit');
    assert.equal(p.pointsPerRequest, undefined);
    assert.equal(p.usdPerRequest, undefined);
  }
  for (const points of [0, 0.01, 0.51, 0.52, 1]) assert.equal(pointsFromQuota(quotaForPoints(points)), points);
});
