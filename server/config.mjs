import { existsSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { quotaPerPoint } from '../shared/billing.mjs';
import { MODEL_API_BASE_URL } from '../shared/endpoints.mjs';
if (existsSync(new URL('../.env.server', import.meta.url))) process.loadEnvFile(new URL('../.env.server', import.meta.url));
export const config = {
  port: Number(process.env.PORT || 8787),
  upstream: process.env.NEW_API_URL || 'http://127.0.0.1:3001',
  database: process.env.PORTAL_DATABASE_URL,
  publicUrl: process.env.PORTAL_PUBLIC_URL || 'https://www.workbuddy999.top',
  modelApiUrl: MODEL_API_BASE_URL,
  origins: (process.env.PORTAL_ORIGINS || 'https://www.workbuddy999.top').split(','),
  // NewAPI stores quota in its internal unit while the portal sells user-facing points.
  // Keep this conversion explicit so changing NewAPI's global quota unit is unnecessary.
  quotaPerPoint,
};
if (!process.env.PORTAL_SECRET || !config.database) throw new Error('请配置 .env.server 中的 PORTAL_SECRET 和 PORTAL_DATABASE_URL');
const secret = createHash('sha256').update(process.env.PORTAL_SECRET).digest();
export const hash = value => createHash('sha256').update(value).digest('hex');
export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decrypt(value) {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', secret, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
export function monthAfter(seconds) {
  // One calendar month in Asia/Shanghai, clamped to the destination month's last day.
  const d = new Date(seconds * 1000 + 8 * 3600000);
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return Math.floor((d.getTime() - 8 * 3600000) / 1000);
}
export class PortalError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
