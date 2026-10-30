import { creditPlans, cnyForPoints } from '../shared/billing.mjs';
// Local preview only. Production actions are delegated to an authenticated BFF.
const STORE = 'workbuddy.portal.v2';
const DEMO_CODES = { 'WB-LOCAL-5000': 5000, 'DE793A42369238A0': 5000 };
export const emptyLedger = () => ({ balance: 0, redemptions: [], orders: [], usage: [], redeemed: [] });
export function redeemInLedger(ledger, rawCode, now = new Date().toISOString()) {
  const code = String(rawCode).trim().toUpperCase();
  if (!DEMO_CODES[code]) throw new Error('兑换码无效，请检查完整兑换码后重试。');
  if (ledger.redeemed.includes(code)) throw new Error('该兑换码已使用，不能重复兑换。');
  const points = DEMO_CODES[code];
  return { ...ledger, balance: ledger.balance + points, redeemed: [...ledger.redeemed, code], redemptions: [{ id: crypto.randomUUID(), code: code.slice(0, 4) + '••••' + code.slice(-4), points, amountCny: cnyForPoints(points), time: now, status: '已兑换' }, ...ledger.redemptions] };
}
export function createPendingOrder(ledger, points, method, now = new Date().toISOString()) {
  if (!creditPlans.some(plan => plan.points === points)) throw new Error('请选择有效积分套餐。');
  if (!['wechat', 'alipay'].includes(method)) throw new Error('请选择支付方式。');
  const order = { id: 'WB' + Date.now() + crypto.randomUUID().slice(0, 6), points, amount: cnyForPoints(points), amountType: 'face', method, time: now, status: '待支付' };
  return { ...ledger, orders: [order, ...ledger.orders] };
}
export function readLedger() {
  try { const v = JSON.parse(localStorage.getItem(STORE)); if (v && Number.isFinite(v.balance) && ['orders','redemptions','usage','redeemed'].every(k=>Array.isArray(v[k]))) return v; } catch { /* A corrupt preview store starts clean. */ }
  return emptyLedger();
}
export function saveLedger(ledger) { localStorage.setItem(STORE, JSON.stringify(ledger)); }
export function isDemoCode(code) { return Object.hasOwn(DEMO_CODES, String(code).trim().toUpperCase()); }

// The BFF contract is explicit: do not expose NewAPI admin credentials to browsers.
export async function portalRequest(path, data) {
  const res = await fetch('/api/portal' + path, { method: data ? 'POST' : 'GET', credentials: 'same-origin', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('会员服务尚未连接，请联系客服。');
  const body = await res.json();
  if (!res.ok || body.success === false) { const error = new Error(body.message || '请求失败，请稍后重试。'); error.status = res.status; throw error; }
  return body.data;
}
export function downloadFile(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
