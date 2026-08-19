import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createRagAgent } from "../dist/agents.js";
import { createKnowledgeBucket } from "../dist/buckets.js";
import { getKnowledgeFile } from "../dist/files.js";

const config = {
  apiKey: "sk-test",
  apiBaseUrl: "https://api.example.test/v1",
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

test("createKnowledgeBucket posts name/slug and honors the idempotency key", async () => {
  const calls = stubFetch(201, { id: "b1", slug: "docs", status: "active" });
  const bucket = await createKnowledgeBucket(config, {
    name: "Docs",
    slug: "docs",
    idempotencyKey: "create-docs-1",
  });
  assert.equal(bucket.id, "b1");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/v1/knowledge/buckets"));
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("Idempotency-Key"), "create-docs-1");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: "Docs",
    slug: "docs",
  });
});

test("createKnowledgeBucket surfaces typed backend errors verbatim", async () => {
  stubFetch(409, {
    error: { code: "bucket_slug_exists", message: "Slug already used." },
  });
  await assert.rejects(
    () => createKnowledgeBucket(config, { name: "Docs", slug: "docs" }),
    (error) => {
      assert.match(String(error), /bucket_slug_exists|Slug already used/);
      return true;
    },
  );
});

test("createRagAgent maps camelCase input to the API contract", async () => {
  const calls = stubFetch(201, {
    model: "calypso-rag-agent:support",
    agent_id: "support",
  });
  const agent = await createRagAgent(config, {
    agentId: "support",
    name: "Support",
    bucketIds: ["b1"],
    bucketSlugs: ["docs"],
    instructions: "Answer from docs only.",
    idempotencyKey: "agent-support-1",
  });
  assert.equal(agent.model, "calypso-rag-agent:support");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/v1/rag-agent/agents"));
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("Idempotency-Key"), "agent-support-1");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    agent_id: "support",
    name: "Support",
    bucket_ids: ["b1"],
    bucket_slugs: ["docs"],
    instructions: "Answer from docs only.",
  });
});

test("createRagAgent omits empty optional fields from the payload", async () => {
  const calls = stubFetch(201, { model: "calypso-rag-agent:x" });
  await createRagAgent(config, { bucketIds: ["b1"] });
  assert.deepEqual(JSON.parse(calls[0].init.body), { bucket_ids: ["b1"] });
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("Idempotency-Key"), null);
});

test("getKnowledgeFile appends verify=gemini only when asked", async () => {
  const calls = stubFetch(200, { id: "f1", status: "indexed" });
  await getKnowledgeFile(config, "f1");
  await getKnowledgeFile(config, "f1", { verify: true });
  assert.ok(calls[0].url.endsWith("/v1/knowledge/files/f1"));
  assert.ok(calls[1].url.endsWith("/v1/knowledge/files/f1?verify=gemini"));
});
