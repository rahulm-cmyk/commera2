import assert from "node:assert/strict";
import test from "node:test";
import {
  createTypeSafePageGenerator,
  createTypeSafeProjectOptions,
} from "../src/typesafe-ai-provider.js";

test("TypeSafe page generator calls systemOne and returns an editable page", async () => {
  let request;
  const generator = createTypeSafePageGenerator({
    model: "jev-test",
    client: {
      async systemOne(input) {
        request = input;
        return { answers: { template: { choice: "clean-minimal" } } };
      },
    },
  });
  const page = await generator({
    title: "Laundry PowerPods",
    brief: "Simple COD product page for busy families",
    product: {
      name: "Laundry PowerPods",
      description: "Compact detergent pods for daily laundry.",
      pricePaise: 39900,
      stock: 12,
    },
  });
  assert.equal(request.model, "jev-test");
  assert.equal(request.state.product.name, "Laundry PowerPods");
  assert.equal(page.hero.headline, "Laundry PowerPods");
  assert.equal(page.hero.eyebrow, "AI SELECTED TEMPLATE");
  assert.ok(page.sections.length >= 3);
});

test("TypeSafe project options stay unavailable until an API key is configured", () => {
  assert.deepEqual(createTypeSafeProjectOptions({}), {});
  assert.deepEqual(
    createTypeSafeProjectOptions({ TYPESAFE_API_KEY: "apikey_test_only_not_real" }),
    {},
  );
  const options = createTypeSafeProjectOptions({
    TYPESAFE_AI_ENABLED: "true",
    TYPESAFE_API_KEY: "apikey_test_only_not_real",
    TYPESAFE_MODEL: "jev-test",
  });
  assert.equal(options.aiProvider.provider, "TypeSafe Jev");
  assert.equal(options.aiProvider.model, "jev-test");
  assert.equal(options.aiProvider.authorized, true);
  assert.equal(typeof options.aiGenerator, "function");
});
