import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildKnowledgeBatchManifest,
  resolveUploadContent,
  stripDataUriPrefix,
  uploadAgentFile,
  uploadKnowledgeFilesBatch,
} from "../dist/files.js";

test("stripDataUriPrefix removes data URI metadata", () => {
  assert.equal(
    stripDataUriPrefix("data:text/plain;base64,aGVsbG8="),
    "aGVsbG8=",
  );
  assert.equal(stripDataUriPrefix("aGVsbG8="), "aGVsbG8=");
});

test("resolveUploadContent decodes base64 content", async () => {
  const content = await resolveUploadContent({
    filename: "hello.txt",
    mimeType: "text/plain",
    contentBase64: "data:text/plain;base64,aGVsbG8=",
  });

  assert.equal(content.filename, "hello.txt");
  assert.equal(content.mimeType, "text/plain");
  assert.equal(Buffer.from(content.bytes).toString("utf8"), "hello");
});

test("resolveUploadContent reads local file paths", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "calypso-mcp-"));
  const filePath = path.join(tempDir, "local.txt");

  try {
    await writeFile(filePath, "local file");
    const content = await resolveUploadContent({
      mimeType: "text/plain",
      filePath,
    });

    assert.equal(content.filename, "local.txt");
    assert.equal(content.mimeType, "text/plain");
    assert.equal(Buffer.from(content.bytes).toString("utf8"), "local file");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveUploadContent requires exactly one content source", async () => {
  await assert.rejects(
    () =>
      resolveUploadContent({
        filename: "invalid.txt",
        mimeType: "text/plain",
      }),
    /Provide exactly one/,
  );

  await assert.rejects(
    () =>
      resolveUploadContent({
        filename: "invalid.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
        filePath: "/tmp/invalid.txt",
      }),
    /Provide exactly one/,
  );
});

test("buildKnowledgeBatchManifest generates unique Firestore-safe client_file_id values", () => {
  const { manifest, clientFileIds } = buildKnowledgeBatchManifest({
    batchIdempotencyKey: "batch-1",
    items: [
      {
        filename: "Fall of the Berlin Wall.html",
        mimeType: "text/html",
        contentBase64: "PGgxPkE8L2gxPg==",
      },
      {
        filename: "Fall of the Berlin Wall.html",
        mimeType: "text/html",
        contentBase64: "PGgxPkI8L2gxPg==",
      },
    ],
  });

  assert.equal(manifest.version, 1);
  assert.equal(manifest.batch_idempotency_key, "batch-1");
  assert.equal(new Set(clientFileIds).size, 2);
  for (const clientFileId of clientFileIds) {
    assert.match(clientFileId, /^[A-Za-z0-9_.-]+$/);
    assert.equal(clientFileId.startsWith("__"), false);
  }
  assert.deepEqual(
    manifest.items.map((item) => item.client_file_id),
    clientFileIds,
  );
});

test("buildKnowledgeBatchManifest rejects batches over 100 files", () => {
  assert.throws(
    () =>
      buildKnowledgeBatchManifest({
        batchIdempotencyKey: "too-many",
        items: Array.from({ length: 101 }, (_, index) => ({
          filename: `file-${index}.txt`,
          mimeType: "text/plain",
          contentBase64: "aGVsbG8=",
        })),
      }),
    /at most 100 files/,
  );
});

test("buildKnowledgeBatchManifest includes shared and per-item bucket fields", () => {
  const { manifest } = buildKnowledgeBatchManifest({
    batchIdempotencyKey: "bucketed",
    bucket: "shared-bucket",
    bucketSlugs: ["shared-slug"],
    createMissingBuckets: true,
    items: [
      {
        filename: "shared.txt",
        mimeType: "text/plain",
        contentBase64: "c2hhcmVk",
      },
      {
        filename: "override.txt",
        mimeType: "text/plain",
        contentBase64: "b3ZlcnJpZGU=",
        bucket: "item-bucket",
        bucketIds: ["bucket-id-1"],
        createMissingBuckets: false,
      },
    ],
  });

  assert.equal(manifest.bucket, "shared-bucket");
  assert.deepEqual(manifest.bucket_slugs, ["shared-slug"]);
  assert.equal(manifest.create_missing_buckets, true);
  assert.equal(manifest.items[1].bucket, "item-bucket");
  assert.deepEqual(manifest.items[1].bucket_ids, ["bucket-id-1"]);
  assert.equal(manifest.items[1].create_missing_buckets, false);
});

test("uploadAgentFile posts target model and bucket id", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.body.get("purpose"), "user_data");
    assert.equal(init.body.get("target_model"), "calypso-rag-agent:pricing");
    assert.equal(init.body.get("bucket_id"), "bucket-pricing");
    assert.ok(init.body.get("file") instanceof Blob);

    return new Response(
      JSON.stringify({
        id: "file-123",
        object: "file",
        bytes: 5,
        created_at: 1,
        filename: "hello.txt",
        purpose: "user_data",
        status: "processed",
        metadata: {
          bucket_id: "bucket-pricing",
          rag_readiness: { state: "active", label: "Ready", is_ready: true },
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const result = await uploadAgentFile(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      {
        filename: "hello.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
        targetModel: "calypso-rag-agent:pricing",
        bucketId: "bucket-pricing",
        waitForReady: false,
      },
    );

    assert.equal(result.id, "file-123");
    assert.equal(result.metadata.bucket_id, "bucket-pricing");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/v1/files");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.get("Authorization"), "Bearer sk-test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadKnowledgeFilesBatch posts multipart manifest and file parts", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const manifest = JSON.parse(init.body.get("manifest"));
    const firstFilePart = init.body.get(manifest.items[0].client_file_id);
    assert.ok(firstFilePart instanceof Blob);

    return new Response(
      JSON.stringify({
        id: "batch_123",
        object: "knowledge_batch",
        status: "accepted",
        accepted: 1,
        rejected: 0,
      }),
      {
        status: 202,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const result = await uploadKnowledgeFilesBatch(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      {
        batchIdempotencyKey: "batch-upload",
        dryRun: true,
        bucket: "rag1",
        items: [
          {
            filename: "hello.txt",
            mimeType: "text/plain",
            contentBase64: "aGVsbG8=",
          },
        ],
      },
    );

    assert.equal(result.id, "batch_123");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.example.test/v1/knowledge/files:batch?dry_run=true",
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.get("Authorization"), "Bearer sk-test");
    const manifest = JSON.parse(calls[0].init.body.get("manifest"));
    assert.equal(manifest.bucket, "rag1");
    assert.equal(manifest.items[0].filename, "hello.txt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadKnowledgeFilesBatch polls batch status with include_items=true", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith("/knowledge/files:batch")) {
      return new Response(
        JSON.stringify({
          id: "batch_poll",
          status: "accepted",
        }),
        {
          status: 202,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "batch_poll",
        status: "active",
        items: [{ client_file_id: "one", status: "active" }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const result = await uploadKnowledgeFilesBatch(
      {
        apiBaseUrl: "https://api.example.test/v1",
        apiKey: "sk-test",
      },
      {
        batchIdempotencyKey: "batch-poll",
        waitForBatchReady: true,
        items: [
          {
            filename: "hello.txt",
            mimeType: "text/plain",
            contentBase64: "aGVsbG8=",
          },
        ],
      },
    );

    assert.equal(result.status, "active");
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].url,
      "https://api.example.test/v1/knowledge/batches/batch_poll?include_items=true",
    );
    assert.equal(calls[1].init.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
