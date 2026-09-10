import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDatabaseTimestamp } from '../src/database-time.js';

test('Database timestamps preserve UTC and explicit offsets across SQLite and PostgreSQL', () => {
  const expected = Date.UTC(2026, 8, 10, 8, 30, 0, 123);
  for (const value of [
    '2026-09-10 08:30:00.123',
    '2026-09-10T08:30:00.123Z',
    '2026-09-10 08:30:00.123456+00',
    '2026-09-10 08:30:00.123+0000',
    '2026-09-10 08:30:00.123+00:00',
    '2026-09-10 13:30:00.123+05',
    '2026-09-10 14:00:00.123+05:30',
    '2026-09-10 03:30:00.123-05',
    '2026-09-10 05:00:00.123-0330',
    new Date(expected),
  ]) assert.equal(parseDatabaseTimestamp(value), expected, String(value));
  assert.equal(parseDatabaseTimestamp('2026-09-10 08:30:00'), expected - 123);
});

test('Missing or malformed timestamps fail closed', () => {
  for (const value of [null, undefined, '', 'invalid', '2026-09-10', '2026-09-10 08:30:00+00Z', new Date(NaN)]) {
    assert.ok(Number.isNaN(parseDatabaseTimestamp(value)), String(value));
  }
});
