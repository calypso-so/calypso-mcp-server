import type { CalypsoRuntimeConfig } from "./config.js";
import { requestJson } from "./files.js";

export type AddKnowledgeWebsiteInput = {
  url: string;
  title?: string;
  tagsHint?: string;
  preferredLanguage?: string;
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
  createMissingBuckets?: boolean;
  idempotencyKey?: string;
};

export type KnowledgeWebsiteObject = {
  object?: string;
  knowledge_id?: string;
  team_id?: string;
  title?: string;
  tags?: string[];
  url?: string;
  summary?: string;
  ingestion_status?: string;
  bucket_assignment?: Record<string, unknown>;
  request_id?: string;
  [key: string]: unknown;
};

/**
 * Ingest a website as bucket-scoped knowledge.
 *
 * Maps to `POST /knowledge/websites` — one shot: the server crawls the URL,
 * generates title/summary/tags, persists the website as knowledge, and
 * bucket-scopes it in the same call. The normalized URL is the create
 * identity per team: a matching `Idempotency-Key` replays the existing
 * website, a collision without one is a typed `409 website_url_exists`.
 * Requires the `knowledge:website:create` capability (explicit-only — this
 * endpoint spends third-party analysis budget per call) and a backend with
 * the 2026-08-20 URL-ingestion routes deployed.
 */
export async function addKnowledgeWebsite(
  config: CalypsoRuntimeConfig,
  input: AddKnowledgeWebsiteInput,
): Promise<KnowledgeWebsiteObject> {
  const url = String(input.url || "").trim();
  if (!url) {
    throw new Error("A website `url` is required.");
  }
  const bucketSlugs = [
    ...(input.bucketSlugs || []),
    ...(input.bucket?.trim() ? [input.bucket.trim()] : []),
  ].filter((slug) => slug.trim().length > 0);
  if (!(input.bucketIds?.length || bucketSlugs.length)) {
    throw new Error(
      "Website ingestion requires bucketIds, bucketSlugs, or bucket.",
    );
  }

  const headers: Record<string, string> = {};
  if (input.idempotencyKey?.trim()) {
    headers["Idempotency-Key"] = input.idempotencyKey.trim();
  }
  return requestJson<KnowledgeWebsiteObject>(config, "/knowledge/websites", {
    method: "POST",
    headers,
    body: JSON.stringify({
      url,
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(input.tagsHint?.trim() ? { tags_hint: input.tagsHint.trim() } : {}),
      ...(input.preferredLanguage?.trim()
        ? { preferred_language: input.preferredLanguage.trim() }
        : {}),
      ...(input.bucketIds?.length ? { bucket_ids: input.bucketIds } : {}),
      ...(bucketSlugs.length ? { bucket_slugs: bucketSlugs } : {}),
      ...(input.createMissingBuckets === true
        ? { create_missing_buckets: true }
        : {}),
    }),
  });
}
