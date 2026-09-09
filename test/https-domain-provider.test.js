import test from "node:test";
import assert from "node:assert/strict";
import { createHttpsDomainProvider } from "../src/https-domain-provider.js";

test("HTTPS domain provider only activates a reachable HTTPS hostname", async () => {
  const calls = [];
  const provider = createHttpsDomainProvider({
    probe: async (hostname) => {
      calls.push(hostname);
      return hostname === "shop.example.com";
    },
  });

  assert.deepEqual(
    await provider.provisionDomain({ domain: { domainName: "shop.example.com" } }),
    { status: "active" },
  );
  assert.deepEqual(
    await provider.provisionDomain({ domain: { domainName: "waiting.example.com" } }),
    { status: "pending" },
  );
  assert.deepEqual(calls, ["shop.example.com", "waiting.example.com"]);
});
