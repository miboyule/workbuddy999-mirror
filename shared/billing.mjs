// Public billing units shared by the portal, provisioning scripts and tests.
export const billing = Object.freeze({ currency: 'CNY', pointsPerCny: 20, usdExchangeRate: 7, quotaPerUsd: 500000, mode: 'upstream_credit' });
export const quotaPerPoint = billing.quotaPerUsd / billing.usdExchangeRate / billing.pointsPerCny;
export const cnyForPoints = points => Number((Number(points) / billing.pointsPerCny).toFixed(8));
export const quotaForPoints = points => Math.max(0, Math.round(Number(points || 0) * quotaPerPoint));
export const pointsFromQuota = quota => Number((Math.max(0, Number(quota || 0)) / quotaPerPoint).toFixed(2));
export const usdForPoints = points => Number((Number(points) / billing.pointsPerCny / billing.usdExchangeRate).toPrecision(15));
export const formatCny = amount => '¥' + Number(amount).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
export const creditPlans = [
  { points: 200, label: '200积分', prefix: 'wb200', count: 20000, note: '支持一键配置' },
  { points: 1000, label: '1000积分', prefix: 'wb1k', count: 10000, note: '轻量体验' },
  { points: 5000, label: '5000积分', prefix: 'wb5k', count: 10000, note: '购买后兑换', hot: true },
  { points: 10000, label: '1万积分', prefix: 'wb1w', count: 10000, note: '购买后兑换' },
  { points: 20000, label: '2万积分', prefix: 'wb2w', count: 5000, note: '购买后兑换' },
  { points: 30000, label: '3万积分', prefix: 'wb3w', count: 5000, note: '可咨询配置指导' },
  { points: 50000, label: '5万积分', prefix: 'wb5w', count: 5000, note: '可咨询配置指导' },
  { points: 100000, label: '10万积分', prefix: 'wb10w', count: 5000, note: '可咨询配置指导' },
].map(plan => Object.freeze({ ...plan, amountCny: cnyForPoints(plan.points), validity: '激活后一个月' }));
export const redemptionPattern = new RegExp('^(' + creditPlans.map(p => p.prefix).join('|') + ')-[0-9a-f]{16}$');
