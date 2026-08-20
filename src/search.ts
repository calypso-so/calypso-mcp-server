import type { CalypsoRuntimeConfig } from "./config.js";

export type KnowledgeSearchResult = {
  source_index: number;
  type: string;
  title?: string | null;
  text?: string | null;
  file_id?: string | null;
  filename?: string | null;
  url?: string | null;
  attributes: Record<string, unknown>;
};

export type KnowledgeSearchResponse = {
  object: string;
  query: string;
  agent?: string | null;
  strategy: string;
  results: KnowledgeSearchResult[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  request_id?: string;
};

export type SearchKnowledgeOptions = {
  query: string;
  agent?: string;
  buckets?: string[];
  maxResults?: number;
};

function buildApiUrl(
  config: CalypsoRuntimeConfig,
  relativePath: string,
): string {
  const normalizedPath = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  return new URL(normalizedPath, `${config.apiBaseUrl}/`).toString();
}

function requireApiKey(config: CalypsoRuntimeConfig): string {
  const apiKey = String(config.apiKey || "").trim();
  if (!apiKey) {
    throw new Error(
      "CALYPSO_API_KEY is required to call Calypso tools, but it is not configured.",
    );
  }
  return apiKey;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatApiError(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const typed = error as { code?: unknown; message?: unknown };
      const code = typeof typed.code === "string" ? typed.code : "api_error";
      const message =
        typeof typed.message === "string" ? typed.message : "Request failed.";
      return `Request failed with status ${status}: ${code}: ${message}`;
    }
  }
  return `Request failed with status ${status}`;
}

export async function searchKnowledge(
  config: CalypsoRuntimeConfig,
  options: SearchKnowledgeOptions,
): Promise<KnowledgeSearchResponse> {
  const apiKey = requireApiKey(config);
  const body: Record<string, unknown> = {
    query: options.query,
  };
  if (options.agent?.trim()) {
    body.agent = options.agent.trim();
  }
  if (options.buckets && options.buckets.length > 0) {
    body.buckets = options.buckets
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
  }
  if (
    typeof options.maxResults === "number" &&
    Number.isFinite(options.maxResults)
  ) {
    body.max_results = Math.max(
      1,
      Math.min(20, Math.floor(options.maxResults)),
    );
  }

  const response = await fetch(buildApiUrl(config, "/search"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(formatApiError(response.status, parsed));
  }
  return parsed as KnowledgeSearchResponse;
}
