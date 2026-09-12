const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateJsonObject(value) {
  if (!object(value)) throw Error('Request body must be a JSON object');
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (current.depth > 40) throw Error('Request body is nested too deeply');
    for (const [key, child] of Object.entries(current.value)) {
      if (unsafeKeys.has(key)) throw Error('Request body contains an unsupported property');
      if (child !== null && typeof child === 'object') pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return value;
}

export async function readJsonBody(req, limit = 8_000_000) {
  const chunks = [];
  let size = 0;
  const stream = typeof req.iterator === 'function' ? req.iterator({ destroyOnReturn: false }) : req;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      req.resume?.();
      throw Object.assign(Error('Request body is too large'), { status: 413 });
    }
    chunks.push(bytes);
  }
  if (!size) return {};
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Error('Invalid JSON body'); }
  return validateJsonObject(value);
}

export function mergeSettings(base, patch) {
  validateJsonObject(patch);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (Object.hasOwn(base, key) && object(base[key])) {
      if (!object(value)) throw Error(`Invalid ${key} settings: expected an object`);
      result[key] = mergeSettings(base[key], value);
    } else result[key] = value;
  }
  return result;
}
