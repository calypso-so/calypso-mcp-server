#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { readFile } from "fs/promises";
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { z } from "zod";

// Get package.json info
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, "..", "package.json");
const packageJsonContent = await readFile(packageJsonPath, "utf8");
const packageInfo = JSON.parse(packageJsonContent) as { name: string; version: string };
const CALYPSO_RAG_AGENT = "calypso-rag-agent";
const DEFAULT_CALYPSO_API_BASE_URL = "https://api.calypso.so/v1";

// Load environment variables
dotenv.config();

// Check for required environment variables
const CALYPSO_API_KEY = process.env.CALYPSO_API_KEY;
const CALYPSO_API_BASE_URL = process.env.CALYPSO_API_BASE_URL || DEFAULT_CALYPSO_API_BASE_URL;

if (!CALYPSO_API_KEY) {
  console.error("Error: CALYPSO_API_KEY is not set in the environment variables");
  console.error(
    `Example: 'env CALYPSO_API_KEY=sk-... CALYPSO_API_BASE_URL=${DEFAULT_CALYPSO_API_BASE_URL} npx -y calypso-mcp'`
  );
  process.exit(1);
}

// Initialize OpenAI client with Calypso (AIcore OpenAI-compatible) API
const calypsoClient = new OpenAI({
  apiKey: CALYPSO_API_KEY,
  baseURL: CALYPSO_API_BASE_URL,
  defaultHeaders: {
    "User-Agent": `${packageInfo.name}/${packageInfo.version} (Node.js/${process.versions.node})`
  },
});

// Create MCP server
const server = new McpServer({
  name: packageInfo.name,
  version: packageInfo.version,
});

// MCP session state (per-process).
// A stable conversation id lets the backend preserve multi-turn RAG context.
// Follow-up turns chain through previous_response_id, matching the native
// OpenAI Responses conversation model implemented by AIcore.
let conversationId = `conv_${randomUUID().replace(/-/g, "")}`;
let previousResponseId: string | null = null;

// Helper function to process streaming responses
async function processStreamingResponse(stream: any): Promise<{ text: string; responseId: string | null }> {
  let fullResponse = "";
  let responseId: string | null = null;

  try {
    // Process the streaming response
    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        fullResponse += event.delta;
      }

      if (
        event.type === "response.output_text.done"
        && !fullResponse
        && typeof event.text === "string"
      ) {
        fullResponse = event.text;
      }

      if (event.type === "response.completed" && typeof event.response?.id === "string") {
        responseId = event.response.id;
      }
    }

    return { text: fullResponse, responseId };
  } catch (error) {
    console.error("Error processing streaming response:", error);
    throw error;
  }
}

type PromptParams = {
  prompt: string;
};

type CalypsoResponsesRequest = ResponseCreateParamsStreaming & {
  conversation?: string | { id: string };
  previous_response_id?: string;
};

server.tool(
  CALYPSO_RAG_AGENT,
  [
    "[CALYPSO RAG AGENT]",
    "Sends each prompt directly to the Calypso RAG agent using the full conversation context.",
    "",
    "Use this when you want Calypso knowledge retrieval and grounded answers from the RAG backend.",
    "Typical requests:",
    "- \"Summarize the key points from our onboarding documentation\"",
    "- \"What does the knowledge base say about campaign approval rules?\"",
    "- \"Compare the documented indexing flow with the retrieval flow\"",
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
    "- \"Summarize the latest indexed knowledge about WhatsApp templates\"",
    "- \"Find the source of truth for campaign approval behavior\"",
    "- \"Start a new topic\" (or use `/new`)",
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
              type: "text",
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
      const response = await calypsoClient.responses.create(
        request as unknown as ResponseCreateParamsStreaming
      );

      const result = await processStreamingResponse(response);
      if (result.responseId) {
        previousResponseId = result.responseId;
      }

      return {
        content: [
          {
            type: "text",
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
            type: "text",
            text: `Error: Failed to process ${CALYPSO_RAG_AGENT} query. ${error}`,
          },
        ],
      };
    }
  }
);

// Start the server with stdio transport
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    process.exit(1);
  }
}

main(); 
