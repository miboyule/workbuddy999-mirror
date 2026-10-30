export const checkedAt = '2026-10-26';
const urls = {
  deepseek: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  glm: 'https://open.bigmodel.cn/pricing',
  kimi: 'https://platform.kimi.com/docs/pricing/chat',
  minimax: 'https://platform.minimaxi.com/docs/guides/pricing-paygo',
  mimo: 'https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go',
};
const reference = (vendor, tiers, note = '') => ({ currency: 'CNY', unit: '百万 Token', tiers, note, url: urls[vendor], checkedAt });
const flash = reference('deepseek', [
  { name: '空闲时段', input: 1, output: 4, cache: 0.02 },
  { name: '工作日高峰', input: 2, output: 8, cache: 0.04 },
], '官方当前 Flash 服务；旧 deepseek-v4-flash ID 继续兼容。北京时间工作日 9–12、14–18 点为高峰，节假日依官网。');
const glm = reference('glm', [{ name: '标准价', input: 8, output: 28, cache: 2 }]);
const row = (id, multiplier, official = null, note = '') => ({
  id, billingUnit: 'upstream_credit', multiplier, checkedAt: '2026-10-27', official,
  basis: '按上游 usage.credit 实际积分 1:1 结算，已包含模型倍率、缓存和活动折扣，不重复乘倍率。',
  note,
});

export const modelPrices = [
  row('deepseek-v4-flash', 0.17, flash),
  row('deepseek-v4.1-flash', 0.11, flash),
  row('deepseek-v4-pro', 0.51, reference('deepseek', [
    { name: '空闲时段', input: 4.5, output: 13.5, cache: 0.15 },
    { name: '工作日高峰', input: 9, output: 27, cache: 0.3 },
  ], '高峰时间规则同 Flash，节假日依官网。')),
  row('glm-5.2', 0.79, glm),
  row('glm-5.3', 0.69, glm),
  row('glm-5.3-flash', 0.08, reference('glm', [
    { name: '标准价', input: 0.8, output: 2.8, cache: 0.23 },
    { name: '限时五折（依官网）', input: 0.4, output: 1.4, cache: 0.115 },
  ])),
  row('hy3', null, null, '限时免费与活动资格以上游实际返回积分为准，不自动延续过期活动。'),
  row('hy4-preview', 0.29, null, '官方 API ID 和价格待核实。'),
  row('hy3-x', 0.05, null, '以渠道返回的实际积分为准。'),
  row('kimi-k2.5', null, null, '渠道未提供可验证倍率和输入输出上限；以实际上游返回积分结算。'),
  row('kimi-k2.6', null, reference('kimi', [{ name: '标准价', input: 6.5, output: 27, cache: 1.1 }], '官方提示 K2 系列计划下线，开放范围依官网。')),
  row('kimi-k2.7', 0.57, null, '现有渠道名称；未确认等同 kimi-k2.7-code，不套用其他模型官方价。'),
  row('kimi-k3-1', 1.62, null, '现有渠道别名；未确认对应官方型号，不套用 K3.1-Pro 的价格。'),
  row('kimi-k3.1-pro', 0.97, reference('kimi', [{ name: '标准价', input: 13, output: 68, cache: 1.3 }], '额外缓存存储/写入费用依官网。')),
  row('mimo-v2.6-pro', 0.13, reference('mimo', [{ name: '实时 API', input: 3, output: 6, cache: 0.025 }], '批量任务半价不适用于实时请求。')),
  row('minimax-m2.7', null, null, '厂商旧型号参考价格尚待核实；本站按上游实际积分结算。'),
  row('minimax-m2.5', null, null, '厂商旧型号参考价格尚待核实；本站按上游实际积分结算。'),
  row('minimax-m3', 0.25, reference('minimax', [
    { name: '标准服务 ≤512K（永久五折价）', input: 2.1, output: 8.4, cache: 0.42 },
    { name: '标准服务 >512K', input: 4.2, output: 16.8, cache: 0.84 },
  ], '优先服务另乘1.5，其他存储费依官网。')),
  row('minimax-m3.1-flash', 0.08, reference('minimax', [{ name: '标准价', input: 1, output: 4, cache: 0.1 }])),
  // Catalog entries are priced here but require a channel before they can be called.
  row('glm-5.1', 0.79, reference('glm', [
    { name: '输入 <32K', input: 6, output: 24, cache: 1.3 },
    { name: '输入 ≥32K', input: 8, output: 28, cache: 2 },
  ])),
  row('glm-5v-turbo', 0.71, reference('glm', [
    { name: '输入 <32K', input: 5, output: 22 },
    { name: '输入 ≥32K', input: 7, output: 26 },
  ])),
  row('kimi-k3', 1.62, reference('kimi', [{ name: '标准价', input: 20, output: 100, cache: 2 }], '额外缓存写入费依官网。')),
  row('kimi-k2.7-code', null, reference('kimi', [{ name: '标准价', input: 6.5, output: 27, cache: 1.3 }])),
  row('kimi-k2.8-preview', 0.77),
  row('step-5-preview', 0.33),
  row('space-bunny', 0.08),
];
export const pricingById = Object.fromEntries(modelPrices.map(p => [p.id, p]));
