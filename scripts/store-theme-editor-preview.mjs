import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_MODE = 'sqlite';
const db = createDatabase(fileURLToPath(new URL('../data/imported-editor-preview.sqlite', import.meta.url)));
const app = createApp({
  db,
  port: 4192,
  merchantAuth: false,
  domainSyncIntervalMs: 0,
  otpProviders: {},
  googleAuthProvider: null,
  accountEmailProvider: null,
  domainOptions: { cnameTarget: 'edge.example.com' },
});

await app.start('127.0.0.1');
console.log(`Store theme editor preview: http://127.0.0.1:${app.port}/online-store/themes/current/edit`);
process.on('SIGINT', async () => { await app.stop(); process.exit(0); });
