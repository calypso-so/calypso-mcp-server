import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { z } from "zod";

import {
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

type RagPromptParams = {
  prompt: string;
  fileIds?: string[];
};

type UploadAgentFileToolParams = {
  filename: string;
  mimeType: string;
  contentBase64?: string;
  filePath?: string;
  targetModel?: string;
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
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    tool: "mcp",
    agent: CALYPSO_RAG_AGENT,
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
  packageInfo: PackageInfo;
}): McpServer {
  const { config, packageInfo } = options;
  let calypsoClient: OpenAI | null = null;

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
        transport: "stdio",
        authentication: "Calypso API key via CALYPSO_API_KEY or --api-key",
        tools: [
          CALYPSO_RAG_AGENT,
          CALYPSO_UPLOAD_AGENT_FILE,
          CALYPSO_UPLOAD_KNOWLEDGE_FILE,
          CALYPSO_UPLOAD_KNOWLEDGE_FILES_BATCH,
        ],
        resources: [
          "calypso://server-info",
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
            steps: [
              "Ask a grounded question using the prompt argument.",
              "Use /new to reset the current MCP conversation.",
              "Ask follow-up questions to reuse the backend response chain.",
            ],
          },
          {
            name: "Agent-store file query",
            tool: CALYPSO_UPLOAD_AGENT_FILE,
            steps: [
              "Upload one file with contentBase64 or filePath.",
              "Use the returned file_id in calypso-rag-agent fileIds.",
              "The MCP marks attached files with rag_policy retrieval semantics.",
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
    "Ask over agent-store file IDs returned by calypso-upload-agent-file.",
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
      description: "Retrieval-backed question over uploaded agent-store files.",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Call calypso-rag-agent with the supplied fileIds so the MCP applies rag_policy retrieval semantics.",
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
              "Pass bucket, bucketSlugs, bucketIds, and createMissingBuckets when the files should be assigned to knowledge buckets.",
              "Use waitForIndexing=true for one file or waitForBatchReady=true for batches when the next answer depends on fresh content.",
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
            text: "Call calypso-rag-agent with prompt `/new` before starting the next unrelated topic.",
          },
        },
      ],
    }),
  );

  // MCP session state is intentionally per-process. The backend maintains the
  // real conversation thread through previous_response_id chaining.
  let conversationId = `conv_${randomUUID().replace(/-/g, "")}`;
  let previousResponseId: string | null = null;

  server.tool(
    CALYPSO_UPLOAD_AGENT_FILE,
    [
      "[CALYPSO UPLOAD AGENT FILE]",
      "Uploads a file into the agent store for retrieval-backed RAG use.",
      "",
      "Use this when you want a compatible `file_id` that can be attached to `calypso-rag-agent`.",
      "The MCP sends `purpose=user_data`, targets the selected RAG agent with `target_model`,",
      "and can optionally wait until the file is RAG-ready before returning.",
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
        .describe("Optional RAG agent id. Defaults to `calypso-rag-agent`."),
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
      waitForReady,
    }: UploadAgentFileToolParams) => {
      try {
        await logEvent("info", "Uploading file to Calypso agent store.", {
          tool: CALYPSO_UPLOAD_AGENT_FILE,
          filename,
          mimeType,
          source: contentBase64 ? "contentBase64" : "filePath",
          waitForReady: waitForReady !== false,
        });

        const uploaded = await uploadAgentFile(config, {
          filename,
          mimeType,
          contentBase64,
          filePath,
          targetModel: String(targetModel || "").trim() || CALYPSO_RAG_AGENT,
          waitForReady,
        });

        await logEvent("info", "Calypso agent-store upload completed.", {
          tool: CALYPSO_UPLOAD_AGENT_FILE,
          fileId: uploaded.id,
          status: uploaded.status,
          readiness: uploaded.metadata?.rag_readiness?.state || null,
        });

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
        await logEvent("error", "Calypso agent-store upload failed.", {
          tool: CALYPSO_UPLOAD_AGENT_FILE,
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Failed to upload file into the agent store. ${error}`,
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
      "Uploads a file into the durable knowledge store and indexing pipeline.",
      "",
      "Use this when you want a file indexed into the broader knowledge corpus instead of",
      "attached directly to a single RAG chat turn. This tool returns knowledge-file and task metadata.",
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
          "Optional existing knowledge bucket ids to assign this upload to.",
        ),
      bucketSlugs: z
        .array(z.string())
        .optional()
        .describe("Optional knowledge bucket slugs to assign this upload to."),
      bucket: z
        .string()
        .optional()
        .describe("Convenience single bucket slug for this upload."),
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
              .describe("Optional existing bucket ids for this item."),
            bucketSlugs: z
              .array(z.string())
              .optional()
              .describe("Optional bucket slugs for this item."),
            bucket: z
              .string()
              .optional()
              .describe("Convenience single bucket slug for this item."),
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
          "Optional existing bucket ids applied to all items by default.",
        ),
      bucketSlugs: z
        .array(z.string())
        .optional()
        .describe("Optional bucket slugs applied to all items by default."),
      bucket: z
        .string()
        .optional()
        .describe(
          "Convenience single bucket slug applied to all items by default.",
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
    },
    async ({ prompt, fileIds }: RagPromptParams) => {
      try {
        const userText = (prompt || "").trim();
        const normalizedFileIds = normalizeFileIds(fileIds);
        if (userText === "/new") {
          conversationId = `conv_${randomUUID().replace(/-/g, "")}`;
          previousResponseId = null;
          await logEvent("notice", "Calypso RAG conversation reset.", {
            tool: CALYPSO_RAG_AGENT,
            conversationId,
          });
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
          conversationId,
          fileCount: normalizedFileIds?.length || 0,
          continuesPreviousResponse: Boolean(previousResponseId),
        });

        const request: CalypsoResponsesRequest = {
          model: CALYPSO_RAG_AGENT,
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
            conversationId,
            fileIds: normalizedFileIds,
          }),
        };

        if (previousResponseId) {
          request.previous_response_id = previousResponseId;
        } else {
          request.conversation = { id: conversationId };
        }

        // Calypso/AIcore accepts Responses fields that this SDK version does not
        // type yet (`conversation` and `previous_response_id`), so we narrow the
        // cast to the API boundary.
        const response = await getCalypsoClient().responses.create(
          request as unknown as ResponseCreateParamsStreaming,
        );
        const result = await processStreamingResponse(response);
        if (result.responseId) {
          previousResponseId = result.responseId;
        }

        await logEvent("info", "Calypso RAG agent response completed.", {
          tool: CALYPSO_RAG_AGENT,
          conversationId,
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
          conversationId,
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
