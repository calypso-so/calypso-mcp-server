import { randomUUID } from "crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  CALYPSO_RAG_AGENT,
  CALYPSO_UPLOAD_AGENT_FILE,
  CALYPSO_UPLOAD_KNOWLEDGE_FILE,
  type CalypsoRuntimeConfig,
} from "./config.js";
import { uploadAgentFile, uploadKnowledgeFile } from "./files.js";

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
  idempotencyKey?: string;
  waitForIndexing?: boolean;
};

type PackageInfo = {
  name: string;
  version: string;
};

type CalypsoResponsesRequest = Omit<ResponseCreateParamsStreaming, "input" | "metadata"> & {
  input: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  conversation?: string | { id: string };
  previous_response_id?: string;
};

async function processStreamingResponse(
  stream: AsyncIterable<ResponseStreamEvent>
): Promise<{ text: string; responseId: string | null }> {
  let fullResponse = "";
  let responseId: string | null = null;

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      fullResponse += event.delta;
    }

    if (event.type === "response.output_text.done" && !fullResponse && typeof event.text === "string") {
      fullResponse = event.text;
    }

    if (event.type === "response.completed" && typeof event.response?.id === "string") {
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
    throw new Error("CALYPSO_API_KEY is required to call Calypso tools, but it is not configured.");
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

  const server = new McpServer({
    name: packageInfo.name,
    version: packageInfo.version,
  });

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
      contentBase64: z.string().optional().describe("Base64-encoded file content. Use this for Smithery or remote execution."),
      filePath: z.string().optional().describe("Local file path to read from disk when the MCP process can access the file."),
      targetModel: z.string().optional().describe("Optional RAG agent id. Defaults to `calypso-rag-agent`."),
      waitForReady: z.boolean().optional().describe("If true, wait until the uploaded file is RAG-ready before returning."),
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
        const uploaded = await uploadAgentFile(config, {
          filename,
          mimeType,
          contentBase64,
          filePath,
          targetModel: String(targetModel || "").trim() || CALYPSO_RAG_AGENT,
          waitForReady,
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
    }
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
      filename: z.string().describe("Display filename for the uploaded knowledge file."),
      mimeType: z.string().describe("Content type for the uploaded knowledge file."),
      contentBase64: z.string().optional().describe("Base64-encoded file content. Use this for Smithery or remote execution."),
      filePath: z.string().optional().describe("Local file path to read from disk when the MCP process can access the file."),
      title: z.string().optional().describe("Optional human-readable title stored with the knowledge file."),
      tags: z.array(z.string()).optional().describe("Optional tags for knowledge-store organization."),
      metadata: z.record(z.unknown()).optional().describe("Optional metadata object serialized onto the upload request."),
      idempotencyKey: z.string().optional().describe("Optional idempotency key for durable upload retries."),
      waitForIndexing: z.boolean().optional().describe("If true, wait until indexing reaches a terminal ready state before returning."),
    },
    async ({
      filename,
      mimeType,
      contentBase64,
      filePath,
      title,
      tags,
      metadata,
      idempotencyKey,
      waitForIndexing,
    }: UploadKnowledgeFileToolParams) => {
      try {
        const result = await uploadKnowledgeFile(config, {
          filename,
          mimeType,
          contentBase64,
          filePath,
          title,
          tags,
          metadata,
          idempotencyKey,
          waitForIndexing,
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
    }
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
      prompt: z.string().describe("Your request. Include context, constraints, and desired output."),
      fileIds: z.array(z.string()).optional().describe("Optional uploaded agent-store `file_id` values to attach with `rag_policy` retrieval semantics."),
    },
    async ({ prompt, fileIds }: RagPromptParams) => {
      try {
        const userText = (prompt || "").trim();
        const normalizedFileIds = normalizeFileIds(fileIds);
        if (userText === "/new") {
          conversationId = `conv_${randomUUID().replace(/-/g, "")}`;
          previousResponseId = null;
          return {
            content: [
              {
                type: "text" as const,
                text: "Started a new Calypso RAG conversation. You can continue with your next request.",
              },
            ],
          };
        }

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
        const response = await getCalypsoClient().responses.create(request as unknown as ResponseCreateParamsStreaming);
        const result = await processStreamingResponse(response);
        if (result.responseId) {
          previousResponseId = result.responseId;
        }

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
    }
  );

  return server;
}
