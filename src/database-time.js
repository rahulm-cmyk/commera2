export function parseDatabaseTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (!match) return NaN;
  // PostgreSQL text timestamps may use +00; ISO parsing needs +00:00.
  const zone = match[3] ? match[3].replace(/^([+-]\d{2})$/, '$1:00').toUpperCase() : 'Z';
  return Date.parse(`${match[1]}T${match[2]}${zone}`);
}
