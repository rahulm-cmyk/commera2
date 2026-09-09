import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { confirmationAnimation, orderConfirmation } from "../src/confirmation.js";

const script = await readFile(new URL("../public/confirmation-animation.js", import.meta.url), "utf8");
function playback({ storage = new Map(), reduced = false, blocked = false, dataset = {} } = {}) {
  const classes = new Set(), timers = [];
  let change;
  const page = {
    dataset: { confirmation: "success", animationEnabled: "true", animationStyle: "checkmark", orderKey: "1:42", ...dataset },
    classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)) },
  };
  const context = {
    document: { querySelector: selector => { assert.equal(selector, "[data-confirmation]"); return page; } },
    sessionStorage: { getItem: key => { if (blocked) throw Error("blocked"); return storage.get(key); }, setItem: (key, value) => storage.set(key, value) },
    window: {
      matchMedia: query => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return { matches: reduced, addEventListener: (_, fn) => { change = fn; }, removeEventListener() {} }; },
      setTimeout: (fn, delay) => { assert.ok(delay <= 1100); timers.push(fn); },
    },
  };
  // There are deliberately no network, order, payment or tracking APIs in this context.
  vm.runInNewContext(script, context);
  return { classes, storage, timers, reduceNow: () => change?.({ matches: true }) };
}

test("confirmation defaults to checkmark and only supports known styles and theme accent", () => {
  assert.deepEqual(confirmationAnimation(), { enabled: true, style: "checkmark", accent: "store" });
  assert.deepEqual(confirmationAnimation({ enabled: "false", style: "unsafe", accent: "red" }), { enabled: false, style: "checkmark", accent: "store" });
});

test("confirmation uses saved payment and order state, not a checkout click", () => {
  assert.match(orderConfirmation({ paymentMethod: "cod", paymentStatus: "pending" }).message, /Pay on delivery/);
  assert.match(orderConfirmation({ paymentMethod: "prepaid", paymentStatus: "paid" }).message, /Payment received/);
  for (const paymentStatus of ["pending", "authorized", "unknown", undefined]) {
    const state = orderConfirmation({ paymentMethod: "prepaid", paymentStatus });
    assert.equal(state.success, false);
    assert.match(state.heading, /checking your payment/);
  }
  for (const paymentStatus of ["failed", "cancelled", "refunded"]) {
    assert.equal(orderConfirmation({ paymentMethod: "cod", paymentStatus }).success, false);
  }
  assert.equal(orderConfirmation({ paymentMethod: "prepaid", paymentStatus: "paid", fulfillmentStatus: "cancelled" }).success, false);
});

test("celebration plays once per order in session and cleans up in about one second", () => {
  const first = playback();
  assert.ok(first.classes.has("confirmation-play"));
  assert.ok(!first.classes.has("confirmation-celebrate"));
  first.timers.forEach(fn => fn());
  assert.equal(first.classes.size, 0);
  assert.equal(playback({ storage: first.storage }).classes.size, 0);
  assert.ok(playback({ storage: first.storage, dataset: { orderKey: "1:43" } }).classes.has("confirmation-play"));
});

test("reduced motion and unavailable storage leave static content; changes stop motion", () => {
  const reduced = playback({ reduced: true });
  assert.equal(reduced.classes.size, 0);
  assert.equal(playback({ storage: reduced.storage }).classes.size, 0);
  assert.equal(playback({ blocked: true }).classes.size, 0);
  const active = playback({ dataset: { animationStyle: "confetti" } });
  assert.ok(active.classes.has("confirmation-celebrate"));
  active.reduceNow();
  assert.equal(active.classes.size, 0);
});

test("disabled, none, pending and failed states cannot celebrate", () => {
  for (const dataset of [{ animationEnabled: "false" }, { animationStyle: "none" }, { confirmation: "other" }]) {
    const run = playback({ dataset });
    assert.equal(run.classes.size, 0);
    assert.equal(run.storage.size, 0);
  }
});

test("sample preview replays without accessing session storage or any action API", () => {
  for (let i = 0; i < 2; i++) {
    const run = playback({ blocked: true, dataset: { confirmationPreview: "true", animationStyle: "confetti" } });
    assert.ok(run.classes.has("confirmation-celebrate"));
    assert.equal(run.storage.size, 0);
  }
});

test("static CSS never hides order details; reduced motion disables confetti", async () => {
  const css = await readFile(new URL("../public/confirmation-animation.css", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /\.thank-you-page \.confirmation-confetti \{ display: none !important/);
  assert.doesNotMatch(css, /(?:summary|heading)[^{]*\{[^}]*opacity: 0/);
});
