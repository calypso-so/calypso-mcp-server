import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { z } from "zod";

import { listKnowledgeBuckets } from "./buckets.js";
import {
  CALYPSO_LIST_KNOWLEDGE_BUCKETS,
  CALYPSO_RAG_AGENT,
  CALYPSO_UPLOAD_AGENT_FILE,
  CALYPSO_UPLOAD_KNOWLEDGE_FILE,
  CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
  type CalypsoRuntimeConfig,
} from "./config.js";
import {
  uploadAgentFile,
  uploadKnowledgeFile,
  uploadKnowledgeFilesBatch,
} from "./files.js";
import {
  type CalypsoRagModelCatalog,
  type CalypsoRagModelDescriptor,
  modelIdsFromCatalog,
} from "./models.js";

type RagPromptParams = {
  prompt: string;
  fileIds?: string[];
  model?: string;
};

type UploadAgentFileToolParams = {
  filename: string;
  mimeType: string;
  contentBase64?: string;
  filePath?: string;
  targetModel?: string;
  bucketId?: string;
  waitForReady?: boolean;
};

type UploadKnowledgeFileToolParams = {
  filename: string;
  mimeType: string;
  contentBase64?: string;
  filePath?: string;
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
  contentBase64?: string;
  filePath?: string;
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
  dryRun?: boolean;
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
  const discoveredModelIds = modelIdsFromCatalog(modelCatalog);
  const discoveredModelIdSet = new Set(discoveredModelIds);
  const modelDescriptorsById = new Map(
    modelCatalog.models.map((model) => [model.id, model]),
  );
  const modelListText = discoveredModelIds
    .map((modelId) => `\`${modelId}\``)
    .join(", ");

  function resolveRagModelId(value?: string): string {
    const modelId = String(value || "").trim() || modelCatalog.defaultModel;
    if (!discoveredModelIdSet.has(modelId)) {
      throw new Error(
        `Unknown Calypso RAG model \`${modelId}\`. Available models: ${discoveredModelIds.join(", ")}`,
      );
    }
    return modelId;
  }

  function resolveRagModelDescriptor(
    modelId: string,
  ): CalypsoRagModelDescriptor {
    const descriptor = modelDescriptorsById.get(modelId);
    if (!descriptor) {
      throw new Error(
        `Unknown Calypso RAG model \`${modelId}\`. Available models: ${discoveredModelIds.join(", ")}`,
      );
    }
    return descriptor;
  }

  function describeModelBuckets(model: CalypsoRagModelDescriptor): string {
    const buckets = model.buckets || [];
    if (buckets.length === 0) {
      return `${model.id}: no active buckets configured`;
    }
    return `${model.id}: ${buckets
      .map(
        (bucket) => `${bucket.name || bucket.slug || bucket.id} (${bucket.id})`,
      )
      .join(", ")}`;
  }

  function resolveUploadBucketId(
    model: CalypsoRagModelDescriptor,
    value?: string,
  ): string {
    const requestedBucketId = String(value || "").trim();
    const bucketIds = (model.buckets || []).map((bucket) => bucket.id);
    if (requestedBucketId) {
      if (!bucketIds.includes(requestedBucketId)) {
        throw new Error(
          `Bucket \`${requestedBucketId}\` is not active for model \`${model.id}\`. Available buckets: ${
            bucketIds.join(", ") || "none"
          }`,
        );
      }
      return requestedBucketId;
    }
    if (bucketIds.length === 1) {
      return bucketIds[0];
    }
    if (bucketIds.length === 0) {
      throw new Error(
        `Model \`${model.id}\` has no active buckets. Bind this agent variant to a knowledge bucket before uploading files.`,
      );
    }
    throw new Error(
      `Model \`${model.id}\` has multiple buckets. Provide bucketId. Available buckets: ${bucketIds.join(", ")}`,
    );
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
        ragModels: modelCatalog,
        transport: "stdio",
        authentication: "Calypso API key via CALYPSO_API_KEY or --api-key",
        tools: [
          CALYPSO_RAG_AGENT,
          CALYPSO_LIST_KNOWLEDGE_BUCKETS,
          CALYPSO_UPLOAD_AGENT_FILE,
          CALYPSO_UPLOAD_KNOWLEDGE_FILE,
          CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
        ],
        resources: [
          "calypso://server-info",
          "calypso://rag-agent-models",
          "calypso://knowledge-buckets",
          "calypso://workflows",
          "calypso://security",
        ],
        prompts: [
          "calypso-knowledge-question",
          "calypso-agent-file-question",
          "calypso-knowledge-ingestion",
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
    (uri) => textResource(uri.toString(), modelCatalog),
  );

  server.resource(
    "calypso-knowledge-buckets",
    "calypso://knowledge-buckets",
    {
      description:
        "Team-scoped Calypso knowledge buckets available to the configured API key.",
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
        "Supported Calypso RAG, agent-file, and knowledge-store workflows.",
      mimeType: "application/json",
    },
    (uri) =>
      textResource(uri.toString(), {
        workflows: [
          {
            name: "Knowledge retrieval",
            tool: CALYPSO_RAG_AGENT,
            models: discoveredModelIds,
            steps: [
              "Ask a grounded question using the prompt argument.",
              `Optionally choose a model variant from: ${discoveredModelIds.join(", ")}.`,
              "Use /new to reset the current MCP conversation.",
              "Ask follow-up questions to reuse the backend response chain.",
            ],
          },
          {
            name: "Bucket-backed agent file query",
            tool: CALYPSO_UPLOAD_AGENT_FILE,
            steps: [
              "Upload one file with contentBase64 or filePath.",
              "Choose a RAG model and bucketId when the model has multiple buckets; single-bucket models auto-select the bucket.",
              "Use the returned file_id in calypso-rag-agent fileIds after indexing is ready.",
              "The uploaded file is stored as durable bucket-backed knowledge for the selected RAG variant.",
            ],
          },
          {
            name: "Durable knowledge ingestion",
            tool: CALYPSO_UPLOAD_KNOWLEDGE_FILE,
            steps: [
              "Upload one source file with optional title, tags, metadata, idempotencyKey, and bucket fields.",
              "Pass waitForIndexing when the next step depends on indexed content.",
              "Query the knowledge base with calypso-rag-agent after indexing completes.",
            ],
          },
          {
            name: "Durable batch knowledge ingestion",
            tool: CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
            steps: [
              "Upload 1 to 100 files with a required batchIdempotencyKey.",
              "Use shared bucketIds, bucketSlugs, bucket, or createMissingBuckets defaults, with optional per-item overrides.",
              "Use dryRun to validate manifests and waitForBatchReady when the next step depends on batch completion.",
              "Read item statuses and bucketSync fields to distinguish accepted, queued, indexed, and bucket-ready states.",
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
          "Use contentBase64 for remote execution.",
          "Use filePath only when the local MCP process should read and upload that exact file.",
          "Clients should request user confirmation before tool calls that include filePath.",
        ],
        logging: [
          "MCP logs are redacted and do not include API keys or file contents.",
          "Logs may include operation names, statuses, file names, file IDs, task IDs, and counts.",
        ],
      }),
  );

  server.prompt(
    "calypso-knowledge-question",
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
              `Available RAG models: ${modelListText}.`,
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
    "calypso-agent-file-question",
    "Ask over bucket-backed file IDs returned by calypso-upload-agent-file.",
    {
      fileIds: z
        .string()
        .optional()
        .describe("Comma-separated uploaded file_id values."),
      question: z
        .string()
        .optional()
        .describe("Question to ask over the uploaded files."),
    },
    ({ fileIds, question }) => ({
      description:
        "Retrieval-backed question over uploaded bucket-backed agent files.",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Call calypso-rag-agent with the supplied fileIds after the file has been uploaded into the selected model bucket.",
              `Available RAG models: ${modelListText}.`,
              `fileIds: ${fileIds || "file_..."}`,
              `Question: ${question || "Ask a focused question about the uploaded file contents."}`,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.prompt(
    "calypso-knowledge-ingestion",
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
              "Use calypso-upload-knowledge-file for one source file, or calypso-upload-knowledge-files-batch for 2 to 100 files.",
              "Pass bucket, bucketSlugs, or bucketIds; durable knowledge uploads require a bucket destination.",
              "Use waitForIndexing=true for one file or waitForBatchReady=true for batches when the next answer depends on fresh content.",
              `Query with one of these RAG models after indexing: ${modelListText}.`,
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

  server.tool(
    CALYPSO_LIST_KNOWLEDGE_BUCKETS,
    [
      "[CALYPSO LIST KNOWLEDGE BUCKETS]",
      "Lists knowledge buckets for the team tied to the configured Calypso API key.",
      "",
      "Use this before uploads when you need bucket ids, slugs, names, member counts,",
      "or bucket-store readiness. This complements RAG model discovery: model discovery",
      "shows which buckets are bound to each agent variant, while this tool lists all buckets for the API key team.",
    ].join("\n"),
    {
      includeArchived: z
        .boolean()
        .optional()
        .describe("If true, include archived buckets. Defaults to false."),
    },
    async ({ includeArchived }: ListKnowledgeBucketsToolParams) => {
      try {
        await logEvent("info", "Listing Calypso knowledge buckets.", {
          tool: CALYPSO_LIST_KNOWLEDGE_BUCKETS,
          includeArchived: includeArchived === true,
        });

        const bucketList = await listKnowledgeBuckets(config, {
          includeArchived,
        });

        await logEvent("info", "Calypso knowledge bucket listing completed.", {
          tool: CALYPSO_LIST_KNOWLEDGE_BUCKETS,
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
        console.error(
          `Error calling ${CALYPSO_LIST_KNOWLEDGE_BUCKETS}:`,
          error,
        );
        await logEvent("error", "Calypso knowledge bucket listing failed.", {
          tool: CALYPSO_LIST_KNOWLEDGE_BUCKETS,
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

  server.tool(
    CALYPSO_UPLOAD_AGENT_FILE,
    [
      "[CALYPSO UPLOAD AGENT FILE]",
      "Uploads a file through the agent-facing API, backed by one durable knowledge bucket.",
      "",
      "Use this when you want a compatible `file_id` that can be attached to `calypso-rag-agent`.",
      "The MCP sends `purpose=user_data`, targets the selected RAG agent with `target_model`,",
      "passes exactly one `bucket_id`, and can optionally wait until the file is RAG-ready before returning.",
      `Bucket bindings by model: ${modelCatalog.models.map(describeModelBuckets).join("; ")}.`,
    ].join("\n"),
    {
      filename: z.string().describe("Display filename for the uploaded file."),
      mimeType: z.string().describe("Content type for the uploaded file."),
      contentBase64: z
        .string()
        .optional()
        .describe(
          "Base64-encoded file content. Use this for Smithery or remote execution.",
        ),
      filePath: z
        .string()
        .optional()
        .describe(
          "Local file path to read from disk when the MCP process can access the file.",
        ),
      targetModel: z
        .string()
        .optional()
        .describe(
          `Optional RAG agent id. Defaults to \`${modelCatalog.defaultModel}\`. Available models: ${discoveredModelIds.join(", ")}.`,
        ),
      bucketId: z
        .string()
        .optional()
        .describe(
          "Required when the selected model has multiple buckets. Auto-selected when the selected model has exactly one active bucket.",
        ),
      waitForReady: z
        .boolean()
        .optional()
        .describe(
          "If true, wait until the uploaded file is RAG-ready before returning.",
        ),
    },
    async ({
      filename,
      mimeType,
      contentBase64,
      filePath,
      targetModel,
      bucketId,
      waitForReady,
    }: UploadAgentFileToolParams) => {
      try {
        await logEvent(
          "info",
          "Uploading file to Calypso bucket-backed agent store.",
          {
            tool: CALYPSO_UPLOAD_AGENT_FILE,
            filename,
            mimeType,
            source: contentBase64 ? "contentBase64" : "filePath",
            waitForReady: waitForReady !== false,
          },
        );

        const selectedTargetModel = resolveRagModelId(targetModel);
        const selectedModel = resolveRagModelDescriptor(selectedTargetModel);
        const selectedBucketId = resolveUploadBucketId(selectedModel, bucketId);
        const uploaded = await uploadAgentFile(config, {
          filename,
          mimeType,
          contentBase64,
          filePath,
          targetModel: selectedTargetModel,
          bucketId: selectedBucketId,
          waitForReady,
        });

        await logEvent(
          "info",
          "Calypso bucket-backed agent upload completed.",
          {
            tool: CALYPSO_UPLOAD_AGENT_FILE,
            fileId: uploaded.id,
            bucketId: selectedBucketId,
            status: uploaded.status,
            readiness: uploaded.metadata?.rag_readiness?.state || null,
          },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatJson(uploaded),
            },
          ],
        };
      } catch (error) {
        console.error(`Error calling ${CALYPSO_UPLOAD_AGENT_FILE}:`, error);
        await logEvent("error", "Calypso bucket-backed agent upload failed.", {
          tool: CALYPSO_UPLOAD_AGENT_FILE,
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to upload file into the selected model bucket. ${error}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    CALYPSO_UPLOAD_KNOWLEDGE_FILE,
    [
      "[CALYPSO UPLOAD KNOWLEDGE FILE]",
      "Uploads a file into the durable bucket-backed knowledge store and indexing pipeline.",
      "",
      "Use this when you want a file indexed into the broader knowledge corpus instead of",
      "attached directly to a single RAG chat turn. This tool returns knowledge-file and task metadata.",
      "A bucket destination is required: pass bucketIds, bucketSlugs, or bucket.",
    ].join("\n"),
    {
      filename: z
        .string()
        .describe("Display filename for the uploaded knowledge file."),
      mimeType: z
        .string()
        .describe("Content type for the uploaded knowledge file."),
      contentBase64: z
        .string()
        .optional()
        .describe(
          "Base64-encoded file content. Use this for Smithery or remote execution.",
        ),
      filePath: z
        .string()
        .optional()
        .describe(
          "Local file path to read from disk when the MCP process can access the file.",
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
    async ({
      filename,
      mimeType,
      contentBase64,
      filePath,
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
          CALYPSO_UPLOAD_KNOWLEDGE_FILE,
        );
        await logEvent("info", "Uploading file to Calypso knowledge store.", {
          tool: CALYPSO_UPLOAD_KNOWLEDGE_FILE,
          filename,
          mimeType,
          source: contentBase64 ? "contentBase64" : "filePath",
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
          tool: CALYPSO_UPLOAD_KNOWLEDGE_FILE,
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
        console.error(`Error calling ${CALYPSO_UPLOAD_KNOWLEDGE_FILE}:`, error);
        await logEvent("error", "Calypso knowledge-store upload failed.", {
          tool: CALYPSO_UPLOAD_KNOWLEDGE_FILE,
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

  server.tool(
    CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
    [
      "[CALYPSO UPLOAD KNOWLEDGE FILES BATCH]",
      "Uploads 1 to 100 files into the durable knowledge store and indexing queue in one request.",
      "",
      "Use this for bulk corpus ingestion. Shared bucket fields apply to every item unless an item",
      "provides its own bucket fields. The tool returns batch-level status and, when requested,",
      "polls until the batch reaches active, partially_active, partially_failed, failed, or timeout.",
      "A shared bucket destination is required unless every item provides its own bucket destination.",
    ].join("\n"),
    {
      items: z
        .array(
          z.object({
            filename: z
              .string()
              .describe("Display filename for this knowledge file."),
            mimeType: z
              .string()
              .describe("Content type for this knowledge file."),
            contentBase64: z
              .string()
              .optional()
              .describe(
                "Base64-encoded file content. Use this for Smithery or remote execution.",
              ),
            filePath: z
              .string()
              .optional()
              .describe(
                "Local file path to read from disk when the MCP process can access the file.",
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
      dryRun: z
        .boolean()
        .optional()
        .describe("If true, validate the batch request without storing files."),
      waitForBatchReady: z
        .boolean()
        .optional()
        .describe(
          "If true, poll batch status with include_items=true until terminal or timeout.",
        ),
    },
    async ({
      items,
      batchIdempotencyKey,
      bucketIds,
      bucketSlugs,
      bucket,
      createMissingBuckets,
      dryRun,
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
          dryRun,
          waitForBatchReady,
        });
        await logEvent("info", "Uploading knowledge file batch to Calypso.", {
          tool: CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
          itemCount: items.length,
          dryRun: dryRun === true,
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
          dryRun,
          waitForBatchReady,
        });

        await logEvent("info", "Calypso knowledge batch upload completed.", {
          tool: CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
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
        console.error(
          `Error calling ${CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH}:`,
          error,
        );
        await logEvent("error", "Calypso knowledge batch upload failed.", {
          tool: CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
          itemCount: items?.length || 0,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to upload the knowledge-file batch. ${error}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    CALYPSO_RAG_AGENT,
    [
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
      `Available RAG models: ${discoveredModelIds.join(", ")}.`,
    ].join("\n"),
    {
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
          `Optional RAG model variant. Defaults to \`${modelCatalog.defaultModel}\`. Available models: ${discoveredModelIds.join(", ")}.`,
        ),
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
              models: discoveredModelIds,
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
