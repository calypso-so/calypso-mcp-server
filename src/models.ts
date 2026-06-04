import { CALYPSO_RAG_AGENT, type CalypsoRuntimeConfig } from "./config.js";

export type CalypsoRagModelDescriptor = {
  id: string;
  base_model?: string;
  profile_id?: string | null;
  source?: string;
  enabled?: boolean;
};

export type CalypsoRagModelCatalog = {
  models: CalypsoRagModelDescriptor[];
  defaultModel: string;
  fetchedAt: string | null;
  source: "api" | "fallback";
  error?: string;
};

type RagAgentModelsResponse = {
  object?: string;
  data?: unknown;
};

const DISCOVERY_TIMEOUT_MS = 2000;

export function fallbackRagModelCatalog(error?: unknown): CalypsoRagModelCatalog {
  return {
    models: [
      {
        id: CALYPSO_RAG_AGENT,
        base_model: CALYPSO_RAG_AGENT,
        profile_id: null,
        source: "default_policy",
        enabled: true,
      },
    ],
    defaultModel: CALYPSO_RAG_AGENT,
    fetchedAt: null,
    source: "fallback",
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  };
}

function buildApiUrl(config: CalypsoRuntimeConfig, relativePath: string): string {
  const normalizedPath = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  return new URL(normalizedPath, `${config.apiBaseUrl}/`).toString();
}

function normalizeModelDescriptor(value: unknown): CalypsoRagModelDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    base_model:
      typeof raw.base_model === "string" && raw.base_model.trim()
        ? raw.base_model.trim()
        : undefined,
    profile_id:
      typeof raw.profile_id === "string" && raw.profile_id.trim()
        ? raw.profile_id.trim()
        : raw.profile_id === null
          ? null
          : undefined,
    source:
      typeof raw.source === "string" && raw.source.trim()
        ? raw.source.trim()
        : undefined,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
  };
}

function normalizeCatalog(response: RagAgentModelsResponse): CalypsoRagModelCatalog {
  const data = Array.isArray(response.data) ? response.data : [];
  const seen = new Set<string>();
  const models = data
    .map(normalizeModelDescriptor)
    .filter((model): model is CalypsoRagModelDescriptor => Boolean(model))
    .filter((model) => {
      if (seen.has(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });

  if (!models.some((model) => model.id === CALYPSO_RAG_AGENT)) {
    models.unshift({
      id: CALYPSO_RAG_AGENT,
      base_model: CALYPSO_RAG_AGENT,
      profile_id: null,
      source: "default_policy",
      enabled: true,
    });
  }

  return {
    models,
    defaultModel: CALYPSO_RAG_AGENT,
    fetchedAt: new Date().toISOString(),
    source: "api",
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export async function loadRagModelCatalog(
  config: CalypsoRuntimeConfig,
): Promise<CalypsoRagModelCatalog> {
  const apiKey = String(config.apiKey || "").trim();
  if (!apiKey) {
    return fallbackRagModelCatalog("CALYPSO_API_KEY is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(buildApiUrl(config, "/rag-agent/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`Model discovery failed with status ${response.status}.`);
    }
    return normalizeCatalog(body as RagAgentModelsResponse);
  } catch (error) {
    return fallbackRagModelCatalog(error);
  } finally {
    clearTimeout(timeout);
  }
}

export function modelIdsFromCatalog(catalog: CalypsoRagModelCatalog): string[] {
  return catalog.models.map((model) => model.id);
}
