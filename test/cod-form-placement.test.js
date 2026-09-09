import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function text(base, path) {
  const response = await fetch(base + path);
  return { status: response.status, body: await response.text() };
}

test("merchant manages upsells and downsells inside COD Form, not Products", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const index = await text(base, "/");
  assert.equal(index.status, 200);
  assert.match(index.body, /data-view="settings">Settings/);
  assert.doesNotMatch(index.body, /data-view="cod-form">COD Form/);

  const script = await text(base, "/app.js");
  assert.equal(script.status, 200);
  assert.match(script.body, /function codFormView/);
  assert.match(script.body, /\["upsells", "Upsells"\]/);
  assert.match(script.body, /\["downsells", "Downsells"\]/);
  assert.match(script.body, /upsellsView\(["']#cod-upsells["']\)/);
  assert.match(script.body, /downsellsView\(["']#cod-downsells["']\)/);
  assert.doesNotMatch(script.body, /\['upsells','COD Upsells'\]/);
  assert.doesNotMatch(script.body, /\['downsells','COD Downsells'\]/);
});
