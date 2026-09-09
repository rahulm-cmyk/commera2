import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/", import.meta.url);

test("modal close button never submits the active add/edit form and explicitly closes the dialog", async () => {
  const [index, script] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("app.js", root), "utf8"),
  ]);
  assert.match(
    index,
    /<button[^>]+id="modal-close"[^>]+type="button"[^>]+aria-label="Close"[^>]*>×<\/button>/,
  );
  assert.match(
    script,
    /\$\(["']#modal-close["']\)\.onclick\s*=\s*\(\)\s*=>\s*modal\.close\(\)/,
  );
});
