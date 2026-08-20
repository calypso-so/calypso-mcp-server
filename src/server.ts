import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { z } from "zod";

import { createRagAgent } from "./agents.js";
import { createKnowledgeBucket, listKnowledgeBuckets } from "./buckets.js";
import {
  CALYPSO_ADD_WEBSITE,
  CALYPSO_CREATE_AGENT,
  CALYPSO_CREATE_BUCKET,
  CALYPSO_GET_FILE,
  CALYPSO_LIST_BUCKETS,
  CALYPSO_RAG_AGENT,
  CALYPSO_UPLOAD_FILE,
  CALYPSO_UPLOAD_FILES_BATCH,
  type CalypsoRuntimeConfig,
} from "./config.js";
import {
  getKnowledgeFile,
  uploadKnowledgeFile,
  uploadKnowledgeFilesBatch,
} from "./files.js";
import {
  type CalypsoRagModelCatalog,
  loadRagModelCatalog,
  modelIdsFromCatalog,
} from "./models.js";
import { addKnowledgeWebsite } from "./websites.js";

type RagPromptParams = {
  prompt: string;
  fileIds?: string[];
  model?: string;
};

type UploadKnowledgeFileToolParams = {
  filename?: string;
  mimeType?: string;
  filePath?: string;
  sourceUrl?: string;
  contentBase64?: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
  createMissingBuckets?: boolean;
  idempotencyKey?: string;
  waitForIndexing?: boolean;
};

type UploadKnowledgeFilesBatchToolItemParams = {
  filename: string;
  mimeType: string;
  filePath?: string;
  contentBase64?: string;
  clientFileId?: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
  createMissingBuckets?: boolean;
};

type UploadKnowledgeFilesBatchToolParams = {
  items: UploadKnowledgeFilesBatchToolItemParams[];
  batchIdempotencyKey: string;
  bucketIds?: string[];
  bucketSlugs?: string[];
  bucket?: string;
  createMissingBuckets?: boolean;
  waitForBatchReady?: boolean;
};

type ListKnowledgeBucketsToolParams = {
  includeArchived?: boolean;
};

type PackageInfo = {
  name: string;
  version: string;
};

type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

type CalypsoResponsesRequest = Omit<
  ResponseCreateParamsStreaming,
  "input" | "metadata"
> & {
  input: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  conversation?: string | { id: string };
  previous_response_id?: string;
};

async function processStreamingResponse(
  stream: AsyncIterable<ResponseStreamEvent>,
): Promise<{ text: string; responseId: string | null }> {
  let fullResponse = "";
  let responseId: string | null = null;

  for await (const event of stream) {
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      fullResponse += event.delta;
    }

    if (
      event.type === "response.output_text.done" &&
      !fullResponse &&
      typeof event.text === "string"
    ) {
      fullResponse = event.text;
    }

    if (
      event.type === "response.completed" &&
      typeof event.response?.id === "string"
    ) {
      responseId = event.response.id;
    }
  }

  return { text: fullResponse, responseId };
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function normalizeFileIds(fileIds?: string[]): string[] | undefined {
  const normalized = (fileIds || [])
    .map((fileId) => String(fileId || "").trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function buildResponsesMetadata(options: {
  conversationId: string;
  fileIds?: string[];
  modelId: string;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    tool: "mcp",
    agent: options.modelId,
    conversation_id: options.conversationId,
  };

  if (options.fileIds && options.fileIds.length > 0) {
    metadata._aicore = {
      file_input_strategy: "rag_policy",
    };
  }

  return metadata;
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

export function createCalypsoMcpServer(options: {
  config: CalypsoRuntimeConfig;
  modelCatalog: CalypsoRagModelCatalog;
  packageInfo: PackageInfo;
}): McpServer {
  const { config, modelCatalog, packageInfo } = options;
  let calypsoClient: OpenAI | null = null;
  // The catalog is mutable state, not a startup constant: it refreshes on every
  // `calypso://rag-agent-models` read and after `calypso-create-agent`, so a
  // variant created mid-session is immediately usable without reconnecting.
  let currentCatalog: CalypsoRagModelCatalog = modelCatalog;
  let discoveredModelIdSet = new Set(modelIdsFromCatalog(currentCatalog));

  async function refreshModelCatalog(): Promise<CalypsoRagModelCatalog> {
    try {
      currentCatalog = await loadRagModelCatalog(config);
      discoveredModelIdSet = new Set(modelIdsFromCatalog(currentCatalog));
    } catch {
      // Keep the last known-good catalog: a transient discovery failure must
      // never regress an already-working model list.
    }
    return currentCatalog;
  }

  async function notifyCatalogChanged(): Promise<void> {
    await refreshModelCatalog();
    // The event that invalidates client caches triggers the refresh signals.
    // Best-effort: transports without a connected client throw harmlessly.
    try {
      server.sendResourceListChanged();
      server.sendToolListChanged();
    } catch {
      /* not connected yet */
    }
  }

  function resolveRagModelId(value?: string): string {
    const modelId = String(value || "").trim() || currentCatalog.defaultModel;
    if (!discoveredModelIdSet.has(modelId)) {
      throw new Error(
        `Unknown Calypso RAG model \`${modelId}\`. See the calypso://rag-agent-models resource for the current list.`,
      );
    }
    return modelId;
  }

  function hasKnowledgeBucketDestination(value: {
    bucketIds?: string[];
    bucketSlugs?: string[];
    bucket?: string;
  }): boolean {
    return Boolean(
      (value.bucketIds || []).some((item) => String(item || "").trim()) ||
        (value.bucketSlugs || []).some((item) => String(item || "").trim()) ||
        String(value.bucket || "").trim(),
    );
  }

  function requireKnowledgeBucketDestination(
    value: {
      bucketIds?: string[];
      bucketSlugs?: string[];
      bucket?: string;
    },
    context: string,
  ): void {
    if (!hasKnowledgeBucketDestination(value)) {
      throw new Error(`${context} requires bucketIds, bucketSlugs, or bucket.`);
    }
  }

  function requireBatchBucketDestinations(
    value: UploadKnowledgeFilesBatchToolParams,
  ): void {
    if (hasKnowledgeBucketDestination(value)) return;
    const missing = value.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !hasKnowledgeBucketDestination(item))
      .map(
        ({ item, index }) =>
          item.clientFileId || item.filename || `item ${index + 1}`,
      );
    if (missing.length > 0) {
      throw new Error(
        `Batch knowledge uploads require a shared bucket destination or a bucket destination on every item. Missing: ${missing.join(", ")}`,
      );
    }
  }

  function getCalypsoClient(): OpenAI {
    if (!calypsoClient) {
      calypsoClient = new OpenAI({
        apiKey: requireApiKey(config),
        baseURL: config.apiBaseUrl,
        defaultHeaders: {
          "User-Agent": `${packageInfo.name}/${packageInfo.version} (Node.js/${process.versions.node})`,
        },
      });
    }

    return calypsoClient;
  }

  const server = new McpServer(
    {
      name: packageInfo.name,
      version: packageInfo.version,
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  async function logEvent(
    level: LogLevel,
    message: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await server.server.sendLoggingMessage({
        level,
        logger: "calypso-mcp",
        data: {
          message,
          ...data,
        },
      });
    } catch {
      // Logging is best-effort and must never break tool execution.
    }
  }

  function textResource(uri: string, value: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: formatJson(value),
        },
      ],
    };
  }

  server.resource(
    "calypso-server-info",
    "calypso://server-info",
    {
      description:
        "Read-only Calypso MCP server metadata, transport, authentication model, and capabilities.",
      mimeType: "application/json",
    },
    (uri) =>
      textResource(uri.toString(), {
        package: packageInfo,
        apiBaseUrl: config.apiBaseUrl,
        apiKeyConfigured: Boolean(config.apiKey),
        ragModels: currentCatalog,
        transport: "stdio",
        authentication: "Calypso API key via CALYPSO_API_KEY or --api-key",
        tools: [
          CALYPSO_RAG_AGENT,
          CALYPSO_LIST_BUCKETS,
          CALYPSO_GET_FILE,
          CALYPSO_UPLOAD_FILE,
          CALYPSO_UPLOAD_FILES_BATCH,
          CALYPSO_CREATE_BUCKET,
          CALYPSO_CREATE_AGENT,
        ],
        resources: [
          "calypso://server-info",
          "calypso://rag-agent-models",
          "calypso://buckets",
          "calypso://workflows",
          "calypso://security",
        ],
        prompts: [
          "calypso-question",
          "calypso-ingestion",
          "calypso-reset-conversation",
        ],
      }),
  );

  server.resource(
    "calypso-rag-agent-models",
    "calypso://rag-agent-models",
    {
      description:
        "Team-scoped Calypso RAG agent model variants discovered from the configured API key.",
      mimeType: "application/json",
    },
    async (uri) => textResource(uri.toString(), await refreshModelCatalog()),
  );

  server.resource(
    "calypso-buckets",
    "calypso://buckets",
    {
      description:
        "Team-scoped Calypso buckets available to the configured API key.",
      mimeType: "application/json",
    },
    async (uri) => {
      const bucketList = await listKnowledgeBuckets(config);
      return textResource(uri.toString(), bucketList);
    },
  );

  server.resource(
    "calypso-workflows",
    "calypso://workflows",
    {
      description:
        "Supported Calypso RAG and knowledge-store upload workflows.",
      mimeType: "application/json",
    },
    (uri) =>
      textResource(uri.toString(), {
        workflows: [
          {
            name: "Knowledge retrieval",
            tool: CALYPSO_RAG_AGENT,
            models: modelIdsFromCatalog(currentCatalog),
            steps: [
              "Ask a grounded question using the prompt argument.",
              "Optionally choose a model variant — read calypso://rag-agent-models for the current list.",
              "Use /new to reset the current MCP conversation.",
              "Ask follow-up questions to reuse the backend response chain.",
            ],
          },
          {
            name: "Durable file ingestion",
            tool: CALYPSO_UPLOAD_FILE,
            steps: [
              "Upload one source file with optional title, tags, metadata, idempotencyKey, and bucket fields.",
              "For local Claude Desktop or Cursor MCP installs, pass filePath for files on the same machine. Use contentBase64 for hosted or remote MCP clients that cannot read local paths.",
              "Pass waitForIndexing when the next step depends on indexed content.",
              "Query the knowledge base with calypso-rag-agent after indexing completes.",
            ],
          },
          {
            name: "Durable batch file ingestion",
            tool: CALYPSO_UPLOAD_FILES_BATCH,
            steps: [
              "Upload 1 to 100 files with a required batchIdempotencyKey.",
              "For local Claude Desktop or Cursor MCP installs, pass filePath per item for files on the same machine. Use contentBase64 per item for hosted or remote MCP clients.",
              "Use shared bucketIds, bucketSlugs, bucket, or createMissingBuckets defaults, with optional per-item overrides.",
              "Use waitForBatchReady when the next step depends on batch completion.",
              "Read item statuses and bucketSync fields to distinguish accepted, queued, indexed, and bucket-ready states.",
            ],
          },
          {
            name: "Provision a new agent end to end",
            tool: CALYPSO_CREATE_AGENT,
            steps: [
              "Create a destination with calypso-create-bucket (or reuse one from calypso-list-buckets).",
              "Upload source files into it with calypso-upload-file or calypso-upload-files-batch.",
              "Poll calypso-get-file (verify=true for provider ground truth) until files are indexed.",
              "Create the agent with calypso-create-agent bound to the bucket; the response's `model` is the usage handle.",
              "Query it immediately with calypso-rag-agent using that model — the catalog refreshes on create.",
            ],
          },
          {
            name: "File inspection",
            tool: CALYPSO_GET_FILE,
            steps: [
              "Resolve fileIds from calypso-list-buckets into filename, mime type, size, and indexing status.",
              "Pass verify=true to cross-check the indexed document against the provider when status looks stale.",
            ],
          },
        ],
      }),
  );

  server.resource(
    "calypso-security",
    "calypso://security",
    {
      description:
        "Operational security notes for Calypso API keys, local file reads, uploads, and logs.",
      mimeType: "application/json",
    },
    (uri) =>
      textResource(uri.toString(), {
        apiKeys: [
          "Provide CALYPSO_API_KEY through MCP client secrets or environment variables.",
          "Do not commit desktop MCP configs or .env files containing real keys.",
          "Rotate keys exposed in logs, screenshots, shell history, or support tickets.",
        ],
        localFileAccess: [
          "Use filePath for local MCP installs, including Claude Desktop and Cursor configs that launch this server with a local command such as npx.",
          "Use contentBase64 for hosted or remote MCP servers, including Smithery-hosted servers, browser/cloud runtimes, and agent containers that cannot read the user's local filesystem.",
          "A filePath must be readable by the machine and user account running the Calypso MCP server process.",
          "Do not pass hosted attachment paths such as /mnt/user-data/uploads as filePath unless this MCP server runs in that same environment.",
          "Clients should request user confirmation before tool calls that include filePath.",
        ],
        logging: [
          "MCP logs are redacted and do not include API keys or file contents.",
          "Logs may include operation names, statuses, file names, file IDs, task IDs, and counts.",
        ],
      }),
  );

  server.prompt(
    "calypso-question",
    "Draft a grounded question for the Calypso RAG knowledge base.",
    {
      topic: z
        .string()
        .optional()
        .describe("Topic or question to ask the knowledge base."),
      constraints: z
        .string()
        .optional()
        .describe("Optional constraints for sources, format, or scope."),
    },
    ({ topic, constraints }) => ({
      description: "Grounded Calypso knowledge-base question.",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Use calypso-rag-agent to answer from the configured Calypso knowledge base.",
              "The current variant list lives in the calypso://rag-agent-models resource.",
              `Topic: ${topic || "Describe the topic or question here."}`,
              constraints
                ? `Constraints: ${constraints}`
                : "Include source-aware reasoning when available.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.prompt(
    "calypso-ingestion",
    "Prepare a durable knowledge-store upload and follow-up query.",
    {
      title: z
        .string()
        .optional()
        .describe("Human-readable title for the knowledge file."),
      tags: z
        .string()
        .optional()
        .describe("Comma-separated tags for the upload."),
      followUpQuestion: z
        .string()
        .optional()
        .describe("Question to ask after indexing completes."),
    },
    ({ title, tags, followUpQuestion }) => ({
      description: "Durable Calypso knowledge ingestion workflow.",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Use calypso-upload-file for one source file, or calypso-upload-files-batch for 2 to 100 files.",
              "Use filePath for local Claude Desktop/Cursor MCP installs when the file is on the same machine; use contentBase64 for hosted or remote MCP clients.",
              "Pass bucket, bucketSlugs, or bucketIds; durable knowledge uploads require a bucket destination.",
              "Use waitForIndexing=true for one file or waitForBatchReady=true for batches when the next answer depends on fresh content.",
              "Query with calypso-rag-agent after indexing; read calypso://rag-agent-models for the variant list.",
              `Title: ${title || "Knowledge file title"}`,
              `Tags: ${tags || "optional, comma-separated tags"}`,
              `After indexing, ask calypso-rag-agent: ${followUpQuestion || "Summarize the newly indexed knowledge."}`,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.prompt(
    "calypso-reset-conversation",
    "Reset the current Calypso RAG conversation.",
    () => ({
      description: "Start a clean Calypso RAG thread.",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Call calypso-rag-agent with prompt `/new` before starting the next unrelated topic. Include a model when only one variant should reset.",
          },
        },
      ],
    }),
  );

  // MCP session state is intentionally per-process. The backend maintains the
  // real conversation thread through previous_response_id chaining.
  type ConversationState = {
    conversationId: string;
    previousResponseId: string | null;
  };
  const conversationStates = new Map<string, ConversationState>();

  function newConversationState(): ConversationState {
    return {
      conversationId: `conv_${randomUUID().replace(/-/g, "")}`,
      previousResponseId: null,
    };
  }

  function getConversationState(modelId: string): ConversationState {
    const existing = conversationStates.get(modelId);
    if (existing) {
      return existing;
    }
    const next = newConversationState();
    conversationStates.set(modelId, next);
    return next;
  }

  function resetConversationState(modelId: string): ConversationState {
    const next = newConversationState();
    conversationStates.set(modelId, next);
    return next;
  }

  server.registerTool(
    CALYPSO_LIST_BUCKETS,
    {
      description: [
        "[CALYPSO LIST BUCKETS]",
        "Lists buckets for the team tied to the configured Calypso API key.",
        "",
        "Use this before uploads when you need bucket ids, slugs, names, member counts,",
        "or bucket-store readiness. This complements RAG model discovery: model discovery",
        "shows which buckets are bound to each agent variant, while this tool lists all buckets for the API key team.",
      ].join("\n"),
      inputSchema: {
        includeArchived: z
          .boolean()
          .optional()
          .describe("If true, include archived buckets. Defaults to false."),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ includeArchived }: ListKnowledgeBucketsToolParams) => {
      try {
        await logEvent("info", "Listing Calypso knowledge buckets.", {
          tool: CALYPSO_LIST_BUCKETS,
          includeArchived: includeArchived === true,
        });

        const bucketList = await listKnowledgeBuckets(config, {
          includeArchived,
        });

        await logEvent("info", "Calypso knowledge bucket listing completed.", {
          tool: CALYPSO_LIST_BUCKETS,
          teamId: bucketList.team_id || null,
          bucketCount: bucketList.buckets.length,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatJson(bucketList),
            },
          ],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_LIST_BUCKETS}:`, error);
        await logEvent("error", "Calypso knowledge bucket listing failed.", {
          tool: CALYPSO_LIST_BUCKETS,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to list Calypso knowledge buckets. ${error}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    CALYPSO_GET_FILE,
    {
      description: [
        "[CALYPSO GET FILE]",
        "Fetches one knowledge file's metadata and indexing status by file id.",
        "",
        "Use this to resolve the opaque `fileIds` returned by calypso-list-buckets",
        "into filename, mime type, size, indexing status, and per-bucket sync state.",
        "Pass verify=true to also ask the provider (Gemini) for ground truth about",
        "the indexed document — slower, but authoritative when status looks stale.",
      ].join("\n"),
      inputSchema: {
        fileId: z
          .string()
          .describe(
            "Knowledge file id, e.g. from calypso-list-buckets fileIds.",
          ),
        verify: z
          .boolean()
          .optional()
          .describe(
            "If true, verify against the provider (?verify=gemini). Slower.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ fileId, verify }: { fileId: string; verify?: boolean }) => {
      try {
        const file = await getKnowledgeFile(config, fileId, { verify });
        return {
          content: [{ type: "text" as const, text: formatJson(file) }],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_GET_FILE}:`, error);
        await logEvent("error", "Calypso file lookup failed.", {
          tool: CALYPSO_GET_FILE,
          fileId,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to fetch the Calypso file. ${error}`,
            },
          ],
        };
      }
    },
  );

  const createdBucketOutput = {
    id: z.string().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    status: z.string().optional(),
  };

  server.registerTool(
    CALYPSO_CREATE_BUCKET,
    {
      description: [
        "[CALYPSO CREATE BUCKET]",
        "Creates an empty bucket to upload files into later.",
        "",
        "Use this for the create-then-fill workflow; uploads can also create",
        "buckets implicitly via bucketSlugs + createMissingBuckets. The server",
        "normalizes the slug and returns 409 `bucket_slug_exists` on collision.",
        "Requires the `knowledge:bucket:create` capability on the API key and a",
        "backend with POST /v1/knowledge/buckets deployed.",
      ].join("\n"),
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(120)
          .describe("Human-readable bucket name."),
        slug: z
          .string()
          .optional()
          .describe(
            "Optional slug; server-normalized. Collision -> bucket_slug_exists.",
          ),
        description: z.string().optional().describe("Optional description."),
        idempotencyKey: z
          .string()
          .optional()
          .describe(
            "Optional Idempotency-Key; replays return the existing bucket.",
          ),
      },
      outputSchema: createdBucketOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: {
      name: string;
      slug?: string;
      description?: string;
      idempotencyKey?: string;
    }) => {
      try {
        const bucket = await createKnowledgeBucket(config, input);
        await logEvent("notice", "Calypso bucket created.", {
          tool: CALYPSO_CREATE_BUCKET,
          bucketId: (bucket as { id?: string }).id || null,
        });
        await notifyCatalogChanged();
        return {
          structuredContent: bucket as Record<string, unknown>,
          content: [{ type: "text" as const, text: formatJson(bucket) }],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_CREATE_BUCKET}:`, error);
        await logEvent("error", "Calypso bucket creation failed.", {
          tool: CALYPSO_CREATE_BUCKET,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to create the Calypso bucket. ${error}`,
            },
          ],
        };
      }
    },
  );

  const createdAgentOutput = {
    model: z.string().optional(),
    agent_id: z.string().optional(),
  };

  server.registerTool(
    CALYPSO_CREATE_AGENT,
    {
      description: [
        "[CALYPSO CREATE AGENT]",
        "Creates a RAG agent variant bound to one or more buckets.",
        "",
        "The success payload leads with `model` — pass it straight to",
        "calypso-rag-agent. Bucket bindings are validated server-side",
        "(`bucket_not_found` for unknown or archived buckets), agent ids are",
        "slug-normalized (`agent_id_exists` on collision), and the plan's agent",
        "cap is enforced (`agent_limit_reached` when full). Requires the",
        "`rag:agent:create` capability and a backend with",
        "POST /v1/rag-agent/agents deployed.",
      ].join("\n"),
      inputSchema: {
        agentId: z
          .string()
          .optional()
          .describe("Optional agent id; slug rules, server-normalized."),
        name: z.string().optional().describe("Optional display name."),
        bucketIds: z
          .array(z.string())
          .optional()
          .describe(
            "Bucket ids to bind. Provide bucketIds and/or bucketSlugs.",
          ),
        bucketSlugs: z
          .array(z.string())
          .optional()
          .describe("Bucket slugs to bind (resolved server-side)."),
        instructions: z
          .string()
          .optional()
          .describe("Optional agent instructions."),
        idempotencyKey: z
          .string()
          .optional()
          .describe(
            "Optional Idempotency-Key; replays return the existing agent.",
          ),
      },
      outputSchema: createdAgentOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: {
      agentId?: string;
      name?: string;
      bucketIds?: string[];
      bucketSlugs?: string[];
      instructions?: string;
      idempotencyKey?: string;
    }) => {
      try {
        if (!input.bucketIds?.length && !input.bucketSlugs?.length) {
          throw new Error(
            "Provide at least one bucket via bucketIds or bucketSlugs.",
          );
        }
        const agent = await createRagAgent(config, input);
        await logEvent("notice", "Calypso RAG agent created.", {
          tool: CALYPSO_CREATE_AGENT,
          model: agent.model || null,
        });
        // Refresh discovery so the new variant is immediately usable in this
        // session, then signal clients to drop their cached lists.
        await notifyCatalogChanged();
        return {
          structuredContent: agent as Record<string, unknown>,
          content: [{ type: "text" as const, text: formatJson(agent) }],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_CREATE_AGENT}:`, error);
        await logEvent("error", "Calypso RAG agent creation failed.", {
          tool: CALYPSO_CREATE_AGENT,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to create the Calypso RAG agent. ${error}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    CALYPSO_ADD_WEBSITE,
    {
      description: [
        "[CALYPSO ADD WEBSITE]",
        "Ingests a website URL as bucket-scoped knowledge.",
        "",
        "One shot: the Calypso backend crawls the URL, generates the title,",
        "summary, and tags, persists the website as knowledge, and assigns it",
        "to the given buckets in the same call. The normalized URL is the",
        "create identity per team: a matching Idempotency-Key replays the",
        "existing website, and a collision without one is a typed",
        "`website_url_exists` conflict. Requires the",
        "`knowledge:website:create` capability (explicit-only) and a backend",
        "with POST /v1/knowledge/websites deployed.",
      ].join("\n"),
      inputSchema: {
        url: z
          .string()
          .describe(
            "Website URL to ingest. Normalized server-side; https:// is assumed when the scheme is missing.",
          ),
        title: z
          .string()
          .optional()
          .describe("Optional title override for the generated analysis."),
        tagsHint: z
          .string()
          .optional()
          .describe("Optional comma-separated hint for generated tags."),
        preferredLanguage: z
          .string()
          .optional()
          .describe(
            "Preferred language for the generated title/summary/tags (e.g. 'en', 'es').",
          ),
        bucketIds: z
          .array(z.string())
          .optional()
          .describe(
            "Bucket ids to assign the website to. Required unless bucketSlugs or bucket is provided.",
          ),
        bucketSlugs: z
          .array(z.string())
          .optional()
          .describe(
            "Bucket slugs to assign the website to. Required unless bucketIds or bucket is provided.",
          ),
        bucket: z
          .string()
          .optional()
          .describe(
            "Convenience single bucket slug. Required unless bucketIds or bucketSlugs is provided.",
          ),
        createMissingBuckets: z
          .boolean()
          .optional()
          .describe("If true, create missing bucket slugs before assignment."),
        idempotencyKey: z
          .string()
          .optional()
          .describe(
            "Optional Idempotency-Key; replays return the existing website.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: {
      url: string;
      title?: string;
      tagsHint?: string;
      preferredLanguage?: string;
      bucketIds?: string[];
      bucketSlugs?: string[];
      bucket?: string;
      createMissingBuckets?: boolean;
      idempotencyKey?: string;
    }) => {
      try {
        await logEvent("info", "Ingesting website into Calypso knowledge.", {
          tool: CALYPSO_ADD_WEBSITE,
          url: input.url,
          bucketCount:
            (input.bucketIds?.length || 0) +
            (input.bucketSlugs?.length || 0) +
            (input.bucket ? 1 : 0),
        });
        const website = await addKnowledgeWebsite(config, input);
        await logEvent("notice", "Calypso website knowledge created.", {
          tool: CALYPSO_ADD_WEBSITE,
          knowledgeId: website.knowledge_id || null,
          status: website.ingestion_status || null,
        });
        return {
          content: [{ type: "text" as const, text: formatJson(website) }],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_ADD_WEBSITE}:`, error);
        await logEvent("error", "Calypso website ingestion failed.", {
          tool: CALYPSO_ADD_WEBSITE,
          url: input.url,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to ingest the website into Calypso knowledge. ${error}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    CALYPSO_UPLOAD_FILE,
    {
      description: [
        "[CALYPSO UPLOAD FILE]",
        "Uploads a file into the durable bucket-backed knowledge store and indexing pipeline.",
        "",
        "Use this when you want a file indexed into the broader knowledge corpus instead of",
        "attached directly to a single RAG chat turn. This tool returns file and task metadata.",
        "A bucket destination is required: pass bucketIds, bucketSlugs, or bucket.",
        "Choose exactly one file source. Use `filePath` when this MCP server runs locally and can read the path, including Claude Desktop or Cursor configs that launch this package with npx. Use `contentBase64` for hosted or remote MCP clients, browser uploads, generated in-memory content, or remote sandbox files that this MCP process cannot read. Use `sourceUrl` for a public http(s) file URL — the Calypso backend fetches it directly (public hosts only, 25MB cap), so the bytes never pass through this MCP process; filename and content type are derived from the remote response. Do not base64-encode local files just to use this tool.",
      ].join("\n"),
      inputSchema: {
        filename: z
          .string()
          .optional()
          .describe(
            "Display filename for the uploaded knowledge file. Required for filePath and contentBase64 sources; derived server-side for sourceUrl.",
          ),
        mimeType: z
          .string()
          .optional()
          .describe(
            "Content type for the uploaded knowledge file. Required for filePath and contentBase64 sources; derived server-side for sourceUrl.",
          ),
        sourceUrl: z
          .string()
          .optional()
          .describe(
            "Public http(s) URL of a file to import. The backend fetches it behind its SSRF policy (public hosts only, 25MB cap) and queues indexing. Typed errors: url_fetch_blocked, url_fetch_failed (retryable), file_too_large.",
          ),
        filePath: z
          .string()
          .optional()
          .describe(
            "Preferred for local MCP installs, including Claude Desktop and Cursor configs that run this package with a local command such as npx. Absolute or relative path readable by the machine running this MCP server. The server reads raw bytes and uploads them through the Calypso upload-session URL; no user-side base64 conversion is needed.",
          ),
        contentBase64: z
          .string()
          .optional()
          .describe(
            "Inline file bytes as base64. Use when filePath is not possible, such as hosted or remote MCP servers, browser-provided files, generated content, or remote sandbox attachment paths that the MCP process cannot read.",
          ),
        title: z
          .string()
          .optional()
          .describe(
            "Optional human-readable title stored with the knowledge file.",
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags for knowledge-store organization."),
        metadata: z
          .record(z.unknown())
          .optional()
          .describe(
            "Optional metadata object serialized onto the upload request.",
          ),
        bucketIds: z
          .array(z.string())
          .optional()
          .describe(
            "Existing knowledge bucket ids to assign this upload to. Required unless bucketSlugs or bucket is provided.",
          ),
        bucketSlugs: z
          .array(z.string())
          .optional()
          .describe(
            "Knowledge bucket slugs to assign this upload to. Required unless bucketIds or bucket is provided.",
          ),
        bucket: z
          .string()
          .optional()
          .describe(
            "Convenience single bucket slug for this upload. Required unless bucketIds or bucketSlugs is provided.",
          ),
        createMissingBuckets: z
          .boolean()
          .optional()
          .describe("If true, create missing bucket slugs before assignment."),
        idempotencyKey: z
          .string()
          .optional()
          .describe("Optional idempotency key for durable upload retries."),
        waitForIndexing: z
          .boolean()
          .optional()
          .describe(
            "If true, wait until indexing reaches a terminal ready state before returning.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      filename,
      mimeType,
      contentBase64,
      filePath,
      sourceUrl,
      title,
      tags,
      metadata,
      bucketIds,
      bucketSlugs,
      bucket,
      createMissingBuckets,
      idempotencyKey,
      waitForIndexing,
    }: UploadKnowledgeFileToolParams) => {
      try {
        requireKnowledgeBucketDestination(
          { bucketIds, bucketSlugs, bucket },
          CALYPSO_UPLOAD_FILE,
        );
        await logEvent("info", "Uploading file to Calypso knowledge store.", {
          tool: CALYPSO_UPLOAD_FILE,
          filename,
          mimeType,
          source: sourceUrl
            ? "sourceUrl"
            : contentBase64
              ? "contentBase64"
              : "filePath",
          tagCount: tags?.length || 0,
          hasMetadata: Boolean(metadata && Object.keys(metadata).length > 0),
          bucketCount:
            (bucketIds?.length || 0) +
            (bucketSlugs?.length || 0) +
            (bucket ? 1 : 0),
          waitForIndexing: waitForIndexing === true,
        });

        const result = await uploadKnowledgeFile(config, {
          filename,
          mimeType,
          contentBase64,
          filePath,
          sourceUrl,
          title,
          tags,
          metadata,
          bucketIds,
          bucketSlugs,
          bucket,
          createMissingBuckets,
          idempotencyKey,
          waitForIndexing,
        });

        await logEvent("info", "Calypso knowledge-store upload completed.", {
          tool: CALYPSO_UPLOAD_FILE,
          fileId: result.file.id,
          taskId: result.task?.id || null,
          status: result.file.status || result.task?.status || null,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatJson(result),
            },
          ],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_UPLOAD_FILE}:`, error);
        await logEvent("error", "Calypso knowledge-store upload failed.", {
          tool: CALYPSO_UPLOAD_FILE,
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to upload file into the knowledge store. ${error}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    CALYPSO_UPLOAD_FILES_BATCH,
    {
      description: [
        "[CALYPSO UPLOAD FILES BATCH]",
        "Uploads 1 to 100 files into the durable knowledge store and indexing queue in one request.",
        "",
        "Use this for bulk corpus ingestion. Shared bucket fields apply to every item unless an item",
        "provides its own bucket fields. The tool returns batch-level status and, when requested,",
        "polls until the batch reaches active, partially_active, partially_failed, failed, or timeout.",
        "A shared bucket destination is required unless every item provides its own bucket destination.",
        "Choose exactly one file source per item. Use `filePath` when this MCP server runs locally and can read each path, including Claude Desktop or Cursor configs that launch this package with npx. Use `contentBase64` for hosted or remote MCP clients, browser uploads, generated in-memory content, or remote sandbox files that this MCP process cannot read. Do not base64-encode local files just to use this tool.",
      ].join("\n"),
      inputSchema: {
        items: z
          .array(
            z.object({
              filename: z
                .string()
                .describe("Display filename for this knowledge file."),
              mimeType: z
                .string()
                .describe("Content type for this knowledge file."),
              filePath: z
                .string()
                .optional()
                .describe(
                  "Preferred for local MCP installs, including Claude Desktop and Cursor configs that run this package with a local command such as npx. Absolute or relative path readable by the machine running this MCP server. The server reads raw bytes and uploads them through the Calypso upload-session URL; no user-side base64 conversion is needed.",
                ),
              contentBase64: z
                .string()
                .optional()
                .describe(
                  "Inline file bytes as base64. Use when filePath is not possible, such as hosted or remote MCP servers, browser-provided files, generated content, or remote sandbox attachment paths that the MCP process cannot read.",
                ),
              clientFileId: z
                .string()
                .optional()
                .describe(
                  "Optional Firestore-safe id for this batch item. Omit to generate one from filename and item position.",
                ),
              title: z
                .string()
                .optional()
                .describe("Optional human-readable title for this item."),
              tags: z
                .array(z.string())
                .optional()
                .describe("Optional tags for this item."),
              metadata: z
                .record(z.unknown())
                .optional()
                .describe("Optional metadata for this item."),
              bucketIds: z
                .array(z.string())
                .optional()
                .describe(
                  "Existing bucket ids for this item. Required when no shared bucket destination is provided.",
                ),
              bucketSlugs: z
                .array(z.string())
                .optional()
                .describe(
                  "Bucket slugs for this item. Required when no shared bucket destination is provided.",
                ),
              bucket: z
                .string()
                .optional()
                .describe(
                  "Convenience single bucket slug for this item. Required when no shared bucket destination is provided.",
                ),
              createMissingBuckets: z
                .boolean()
                .optional()
                .describe(
                  "If true, create missing bucket slugs for this item before assignment.",
                ),
            }),
          )
          .min(1)
          .max(100)
          .describe("Knowledge files to upload in this batch."),
        batchIdempotencyKey: z
          .string()
          .describe(
            "Required idempotency key used to derive the durable batch id.",
          ),
        bucketIds: z
          .array(z.string())
          .optional()
          .describe(
            "Existing bucket ids applied to all items by default. Required unless every item has a bucket destination.",
          ),
        bucketSlugs: z
          .array(z.string())
          .optional()
          .describe(
            "Bucket slugs applied to all items by default. Required unless every item has a bucket destination.",
          ),
        bucket: z
          .string()
          .optional()
          .describe(
            "Convenience single bucket slug applied to all items by default. Required unless every item has a bucket destination.",
          ),
        createMissingBuckets: z
          .boolean()
          .optional()
          .describe(
            "If true, create missing shared bucket slugs before assignment.",
          ),
        waitForBatchReady: z
          .boolean()
          .optional()
          .describe(
            "If true, poll batch status with include_items=true until terminal or timeout.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      items,
      batchIdempotencyKey,
      bucketIds,
      bucketSlugs,
      bucket,
      createMissingBuckets,
      waitForBatchReady,
    }: UploadKnowledgeFilesBatchToolParams) => {
      try {
        requireBatchBucketDestinations({
          items,
          batchIdempotencyKey,
          bucketIds,
          bucketSlugs,
          bucket,
          createMissingBuckets,
          waitForBatchReady,
        });
        await logEvent("info", "Uploading knowledge file batch to Calypso.", {
          tool: CALYPSO_UPLOAD_FILES_BATCH,
          itemCount: items.length,
          sharedBucketCount:
            (bucketIds?.length || 0) +
            (bucketSlugs?.length || 0) +
            (bucket ? 1 : 0),
          waitForBatchReady: waitForBatchReady === true,
        });

        const result = await uploadKnowledgeFilesBatch(config, {
          items,
          batchIdempotencyKey,
          bucketIds,
          bucketSlugs,
          bucket,
          createMissingBuckets,
          waitForBatchReady,
        });

        await logEvent("info", "Calypso knowledge batch upload completed.", {
          tool: CALYPSO_UPLOAD_FILES_BATCH,
          batchId: result.id,
          status: result.status || null,
          accepted: result.accepted ?? null,
          rejected: result.rejected ?? null,
          itemCount: result.items?.length || items.length,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatJson(result),
            },
          ],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_UPLOAD_FILES_BATCH}:`, error);
        await logEvent("error", "Calypso knowledge batch upload failed.", {
          tool: CALYPSO_UPLOAD_FILES_BATCH,
          itemCount: items?.length || 0,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to upload the file batch. ${error}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    CALYPSO_RAG_AGENT,
    {
      description: [
        "[CALYPSO RAG AGENT]",
        "Sends each prompt directly to the Calypso RAG agent using the full conversation context.",
        "",
        "Use this when you want Calypso knowledge retrieval and grounded answers from the RAG backend.",
        "Typical requests:",
        '- "Summarize the key points from our onboarding documentation"',
        '- "What does the knowledge base say about campaign approval rules?"',
        '- "Compare the documented indexing flow with the retrieval flow"',
        '- "Answer using the uploaded file ids: [\\"file_123\\"]"',
        "",
        "Responses API behavior:",
        "- First turns start a named Calypso conversation via `/v1/responses`.",
        "- Follow-up turns chain with `previous_response_id` so the backend owns conversation state.",
        "- When `fileIds` are provided, the MCP uses `rag_policy` retrieval semantics instead of inline attachment stuffing.",
        "",
        "MCP session behavior:",
        "- This tool maintains a stable conversation id in the background for multi-turn retrieval context.",
        "- Use `/new` to start a fresh conversation and clear the current context window.",
        "",
        "Quick commands (examples):",
        '- "Summarize the latest indexed knowledge about WhatsApp templates"',
        '- "Find the source of truth for campaign approval behavior"',
        '- "Start a new topic" (or use `/new`)',
        "",
        "The authoritative, refreshable variant list lives in the `calypso://rag-agent-models` resource — do not cache this description.",
      ].join("\n"),
      inputSchema: {
        prompt: z
          .string()
          .describe(
            "Your request. Include context, constraints, and desired output.",
          ),
        fileIds: z
          .array(z.string())
          .optional()
          .describe(
            "Optional uploaded agent-store `file_id` values to attach with `rag_policy` retrieval semantics.",
          ),
        model: z
          .string()
          .optional()
          .describe(
            `Optional RAG model variant. Defaults to \`${currentCatalog.defaultModel}\`. Read the calypso://rag-agent-models resource for the current list.`,
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ prompt, fileIds, model }: RagPromptParams) => {
      try {
        const userText = (prompt || "").trim();
        const normalizedFileIds = normalizeFileIds(fileIds);
        const selectedModel = resolveRagModelId(model);
        const conversationState = getConversationState(selectedModel);
        if (userText === "/new") {
          if (String(model || "").trim()) {
            const resetState = resetConversationState(selectedModel);
            await logEvent("notice", "Calypso RAG conversation reset.", {
              tool: CALYPSO_RAG_AGENT,
              model: selectedModel,
              conversationId: resetState.conversationId,
            });
          } else {
            conversationStates.clear();
            await logEvent("notice", "Calypso RAG conversations reset.", {
              tool: CALYPSO_RAG_AGENT,
              models: modelIdsFromCatalog(currentCatalog),
            });
          }
          return {
            content: [
              {
                type: "text" as const,
                text: "Started a new Calypso RAG conversation. You can continue with your next request.",
              },
            ],
          };
        }

        await logEvent("info", "Calling Calypso RAG agent.", {
          tool: CALYPSO_RAG_AGENT,
          model: selectedModel,
          conversationId: conversationState.conversationId,
          fileCount: normalizedFileIds?.length || 0,
          continuesPreviousResponse: Boolean(
            conversationState.previousResponseId,
          ),
        });

        const request: CalypsoResponsesRequest = {
          model: selectedModel,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: userText,
                },
                ...(normalizedFileIds || []).map((fileId) => ({
                  type: "input_file" as const,
                  file_id: fileId,
                })),
              ],
            },
          ],
          stream: true,
          store: true,
          metadata: buildResponsesMetadata({
            conversationId: conversationState.conversationId,
            fileIds: normalizedFileIds,
            modelId: selectedModel,
          }),
        };

        if (conversationState.previousResponseId) {
          request.previous_response_id = conversationState.previousResponseId;
        } else {
          request.conversation = { id: conversationState.conversationId };
        }

        // Calypso/AIcore accepts Responses fields that this SDK version does not
        // type yet (`conversation` and `previous_response_id`), so we narrow the
        // cast to the API boundary.
        const response = await getCalypsoClient().responses.create(
          request as unknown as ResponseCreateParamsStreaming,
        );
        const result = await processStreamingResponse(response);
        if (result.responseId) {
          conversationStates.set(selectedModel, {
            conversationId: conversationState.conversationId,
            previousResponseId: result.responseId,
          });
        }

        await logEvent("info", "Calypso RAG agent response completed.", {
          tool: CALYPSO_RAG_AGENT,
          model: selectedModel,
          conversationId: conversationState.conversationId,
          responseId: result.responseId,
          textLength: result.text.length,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: result.text,
            },
          ],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_RAG_AGENT}:`, error);
        await logEvent("error", "Calypso RAG agent call failed.", {
          tool: CALYPSO_RAG_AGENT,
          model: String(model || "").trim() || modelCatalog.defaultModel,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to process ${CALYPSO_RAG_AGENT} query. ${error}`,
            },
          ],
        };
      }
    },
  );

  return server;
}
