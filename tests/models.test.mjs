import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fallbackRagModelCatalog,
  loadRagModelCatalog,
  modelIdsFromCatalog,
} from "../dist/models.js";

test("fallbackRagModelCatalog returns the base RAG model", () => {
  const catalog = fallbackRagModelCatalog();

  assert.equal(catalog.source, "fallback");
  assert.deepEqual(modelIdsFromCatalog(catalog), ["calypso-rag-agent"]);
  assert.equal(catalog.defaultModel, "calypso-rag-agent");
});

test("loadRagModelCatalog falls back without an API key", async () => {
  const catalog = await loadRagModelCatalog({
    apiBaseUrl: "https://api.example.test/v1",
  });

  assert.equal(catalog.source, "fallback");
  assert.deepEqual(modelIdsFromCatalog(catalog), ["calypso-rag-agent"]);
});

test("loadRagModelCatalog parses REST model discovery response", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        object: "rag_agent_model_list",
        team_id: "team_123",
        data: [
          {
            id: "calypso-rag-agent",
            base_model: "calypso-rag-agent",
            profile_id: null,
            source: "default_policy",
            enabled: true,
            bucket_ids: ["bucket-default"],
            buckets: [
              {
                id: "bucket-default",
                name: "Default Docs",
                slug: "default-docs",
                status: "active",
                member_count: 3,
              },
            ],
            missing_bucket_ids: [],
          },
          {
            id: "calypso-rag-agent:pricing",
            base_model: "calypso-rag-agent",
            profile_id: "pricing",
            source: "named_profile",
            enabled: true,
            bucket_ids: ["bucket-pricing", "missing-bucket"],
            buckets: [
              {
                id: "bucket-pricing",
                name: "Pricing Docs",
                slug: "pricing-docs",
                status: "active",
              },
            ],
            missing_bucket_ids: ["missing-bucket"],
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const catalog = await loadRagModelCatalog({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
    });

    assert.equal(catalog.source, "api");
    assert.deepEqual(modelIdsFromCatalog(catalog), [
      "calypso-rag-agent",
      "calypso-rag-agent:pricing",
    ]);
    assert.deepEqual(catalog.models[0].bucket_ids, ["bucket-default"]);
    assert.equal(catalog.models[0].buckets[0].name, "Default Docs");
    assert.deepEqual(catalog.models[1].missing_bucket_ids, ["missing-bucket"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/v1/rag-agent/models");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
