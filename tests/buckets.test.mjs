import assert from "node:assert/strict";
import { test } from "node:test";

import {
  listKnowledgeBuckets,
  normalizeKnowledgeBucketList,
} from "../dist/buckets.js";

test("normalizeKnowledgeBucketList normalizes and deduplicates buckets", () => {
  const result = normalizeKnowledgeBucketList({
    team_id: "team-1",
    request_id: "req-1",
    buckets: [
      {
        id: "bucket-1",
        teamId: "team-1",
        slug: "contracts",
        name: "Contracts",
        description: "",
        status: "active",
        knowledgeIds: ["file-1", "file-1", ""],
        memberCount: 1,
        counts: { total: 1, file: 1, ignored: "nope" },
        bucketStore: {
          status: "active",
          member_count: 1,
          indexed_member_count: 1,
          pending_member_count: 0,
        },
      },
      {
        id: "bucket-1",
        name: "Duplicate",
      },
      {
        id: "",
        name: "Ignored",
      },
    ],
  });

  assert.equal(result.team_id, "team-1");
  assert.equal(result.request_id, "req-1");
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].id, "bucket-1");
  assert.equal(result.buckets[0].description, null);
  assert.deepEqual(result.buckets[0].knowledgeIds, ["file-1"]);
  assert.deepEqual(result.buckets[0].counts, { total: 1, file: 1 });
  assert.equal(result.buckets[0].bucketStore.status, "active");
});

test("listKnowledgeBuckets calls public bucket endpoint with include_archived", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        team_id: "team-1",
        buckets: [{ id: "bucket-1", slug: "contracts", knowledgeIds: [] }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const result = await listKnowledgeBuckets(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      {
        includeArchived: true,
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.example.test/v1/knowledge/buckets?include_archived=true",
    );
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
    assert.equal(result.buckets[0].id, "bucket-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listKnowledgeBuckets formats public API errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "invalid_api_key",
          message: "Invalid API key.",
        },
      }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    await assert.rejects(
      () =>
        listKnowledgeBuckets({
          apiBaseUrl: "https://api.example.test/v1",
          apiKey: "sk-test",
        }),
      /401: invalid_api_key: Invalid API key/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
