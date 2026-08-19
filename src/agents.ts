import type { CalypsoRuntimeConfig } from "./config.js";
import { requestJson } from "./files.js";

export type CreateRagAgentInput = {
  agentId?: string;
  name?: string;
  bucketIds?: string[];
  bucketSlugs?: string[];
  instructions?: string;
  idempotencyKey?: string;
};

export type CreatedRagAgent = {
  model?: string;
  agent_id?: string;
  [key: string]: unknown;
};

/**
 * Create a RAG agent variant bound to one or more buckets.
 *
 * Maps to `POST /rag-agent/agents` — the server validates bucket bindings at
 * write time and enforces the plan's `agentProfiles` cap, so typed errors
 * (`bucket_not_found`, `agent_id_exists`, `agent_limit_reached`) surface here
 * verbatim for the tool layer to relay.
 */
export async function createRagAgent(
  config: CalypsoRuntimeConfig,
  input: CreateRagAgentInput,
): Promise<CreatedRagAgent> {
  const headers: Record<string, string> = {};
  if (input.idempotencyKey) {
    headers["Idempotency-Key"] = input.idempotencyKey;
  }
  return requestJson<CreatedRagAgent>(config, "/rag-agent/agents", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(input.agentId ? { agent_id: input.agentId } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.bucketIds?.length ? { bucket_ids: input.bucketIds } : {}),
      ...(input.bucketSlugs?.length ? { bucket_slugs: input.bucketSlugs } : {}),
      ...(input.instructions ? { instructions: input.instructions } : {}),
    }),
  });
}
