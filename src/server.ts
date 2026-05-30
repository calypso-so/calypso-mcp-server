import { randomUUID } from "crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from "openai/resources/responses/responses";
import { z } from "zod";

import { CALYPSO_RAG_AGENT, type CalypsoRuntimeConfig } from "./config.js";

type PromptParams = {
  prompt: string;
};

type PackageInfo = {
  name: string;
  version: string;
};

type CalypsoResponsesRequest = ResponseCreateParamsStreaming & {
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

export function createCalypsoMcpServer(options: {
  config: CalypsoRuntimeConfig;
  packageInfo: PackageInfo;
}): McpServer {
  const { config, packageInfo } = options;

  const calypsoClient = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.apiBaseUrl,
    defaultHeaders: {
      "User-Agent": `${packageInfo.name}/${packageInfo.version} (Node.js/${process.versions.node})`,
    },
  });

  const server = new McpServer({
    name: packageInfo.name,
    version: packageInfo.version,
  });

  // MCP session state is intentionally per-process. The backend maintains the
  // real conversation thread through previous_response_id chaining.
  let conversationId = `conv_${randomUUID().replace(/-/g, "")}`;
  let previousResponseId: string | null = null;

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
      "",
      "Responses API behavior:",
      "- First turns start a named Calypso conversation via `/v1/responses`.",
      "- Follow-up turns chain with `previous_response_id` so the backend owns conversation state.",
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
    },
    async ({ prompt }: PromptParams) => {
      try {
        const userText = (prompt || "").trim();
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
              ],
            },
          ],
          stream: true,
          store: true,
          metadata: {
            tool: "mcp",
            agent: CALYPSO_RAG_AGENT,
            conversation_id: conversationId,
          },
        };

        if (previousResponseId) {
          request.previous_response_id = previousResponseId;
        } else {
          request.conversation = { id: conversationId };
        }

        // Calypso/AIcore accepts Responses fields that this SDK version does not
        // type yet (`conversation` and `previous_response_id`), so we narrow the
        // cast to the API boundary.
        const response = await calypsoClient.responses.create(request as unknown as ResponseCreateParamsStreaming);
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
