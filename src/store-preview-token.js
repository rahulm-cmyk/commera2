import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function createStorePreviewTokens({ secret = randomBytes(32), now = Date.now } = {}) {
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    issue(storeId, hostname) {
      const payload = Buffer.from(JSON.stringify({ storeId, hostname, expires: now() + 10 * 60_000 })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    verify(token, storeId, hostname) {
      if (typeof token !== 'string' || token.length > 2048) return false;
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra !== undefined) return false;
      const actual = Buffer.from(signature), expected = Buffer.from(sign(payload));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
      try {
        const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return value.storeId === storeId && value.hostname === hostname &&
          Number.isFinite(value.expires) && value.expires > now() && value.expires <= now() + 10 * 60_000;
      } catch { return false; }
    },
  };
}
