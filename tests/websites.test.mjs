import assert from "node:assert/strict";
import { test } from "node:test";
import {
  importKnowledgeFileFromUrl,
  uploadKnowledgeFile,
} from "../dist/files.js";
import { addKnowledgeWebsite } from "../dist/websites.js";

const CONFIG = {
  apiBaseUrl: "https://api.test/v1",
  apiKey: "sk-test",
};

function withMockedFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("addKnowledgeWebsite posts snake_case payload with idempotency header", async () => {
  await withMockedFetch(
    () =>
      jsonResponse({
        object: "knowledge_website",
        knowledge_id: "w1",
        ingestion_status: "ready",
      }),
    async (calls) => {
      const result = await addKnowledgeWebsite(CONFIG, {
        url: "https://example.com/pricing",
        title: "Pricing",
        tagsHint: "pricing, plans",
        preferredLanguage: "en",
        bucketSlugs: ["docs"],
        bucket: "extra",
        createMissingBuckets: true,
        idempotencyKey: "idem-1",
      });

      assert.equal(result.knowledge_id, "w1");
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.endsWith("/knowledge/websites"));
      const headers = new Headers(calls[0].init.headers);
      assert.equal(headers.get("Idempotency-Key"), "idem-1");
      assert.equal(headers.get("Authorization"), "Bearer sk-test");
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body, {
        url: "https://example.com/pricing",
        title: "Pricing",
        tags_hint: "pricing, plans",
        preferred_language: "en",
        bucket_slugs: ["docs", "extra"],
        create_missing_buckets: true,
      });
    },
  );
});

test("addKnowledgeWebsite requires a bucket destination", async () => {
  await assert.rejects(
    addKnowledgeWebsite(CONFIG, { url: "https://example.com" }),
    /bucketIds, bucketSlugs, or bucket/,
  );
});

test("importKnowledgeFileFromUrl maps the flat response to file+task", async () => {
  await withMockedFetch(
    () =>
      jsonResponse(
        {
          object: "knowledge_file",
          knowledge_id: "k1",
          task_id: "t1",
          title: "Doc",
          filename: "doc.pdf",
          mime_type: "application/pdf",
          size_bytes: 123,
          ingestion_status: "queued",
          bucket_assignment: { assigned: ["b1"] },
        },
        201,
      ),
    async (calls) => {
      const result = await importKnowledgeFileFromUrl(CONFIG, {
        sourceUrl: "https://example.com/doc.pdf",
        tags: ["a", "b"],
        bucketSlugs: ["docs"],
        idempotencyKey: "idem-2",
      });

      assert.equal(result.file.id, "k1");
      assert.equal(result.file.status, "queued");
      assert.equal(result.file.filename, "doc.pdf");
      assert.equal(result.task.id, "t1");
      assert.ok(calls[0].url.endsWith("/knowledge/files/import-url"));
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.url, "https://example.com/doc.pdf");
      // The import endpoint takes tags as a comma-separated string.
      assert.equal(body.tags, "a,b");
      assert.deepEqual(body.bucket_slugs, ["docs"]);
      const headers = new Headers(calls[0].init.headers);
      assert.equal(headers.get("Idempotency-Key"), "idem-2");
    },
  );
});

test("uploadKnowledgeFile dispatches sourceUrl to the import endpoint", async () => {
  await withMockedFetch(
    () => jsonResponse({ knowledge_id: "k2", ingestion_status: "queued" }, 201),
    async (calls) => {
      const result = await uploadKnowledgeFile(CONFIG, {
        sourceUrl: "https://example.com/doc.pdf",
        bucket: "docs",
      });
      assert.equal(result.file.id, "k2");
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.endsWith("/knowledge/files/import-url"));
    },
  );
});

test("uploadKnowledgeFile rejects sourceUrl combined with local sources", async () => {
  await assert.rejects(
    uploadKnowledgeFile(CONFIG, {
      sourceUrl: "https://example.com/doc.pdf",
      contentBase64: "aGk=",
      bucket: "docs",
    }),
    /exactly one of `contentBase64`, `filePath`, or `sourceUrl`/,
  );
  await assert.rejects(
    uploadKnowledgeFile(CONFIG, {
      sourceUrl: "https://example.com/doc.pdf",
      filePath: "/tmp/doc.pdf",
      bucket: "docs",
    }),
    /exactly one of/,
  );
});

test("importKnowledgeFileFromUrl requires a bucket destination", async () => {
  await assert.rejects(
    importKnowledgeFileFromUrl(CONFIG, {
      sourceUrl: "https://example.com/doc.pdf",
    }),
    /bucketIds, bucketSlugs, or bucket/,
  );
});
