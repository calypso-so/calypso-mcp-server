# Calypso Multimodal RAG MCP Server

[![smithery badge](https://smithery.ai/badge/multimodal-rag/calypso-mcp-server)](https://smithery.ai/servers/multimodal-rag/calypso-mcp-server)
[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/calypso-so/calypso-mcp-server)](https://archestra.ai/mcp-catalog/calypso-so__calypso-mcp-server)
[![npm version](https://img.shields.io/npm/v/@calypsohq/multimodal-rag-mcp-server)](https://www.npmjs.com/package/@calypsohq/multimodal-rag-mcp-server)
[![License](https://img.shields.io/github/license/calypso-so/calypso-mcp-server)](./LICENSE)
[![CI](https://github.com/calypso-so/calypso-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/calypso-so/calypso-mcp-server/actions/workflows/ci.yml)

This MCP server exposes the **Calypso Multimodal RAG agent** to MCP clients such as Cursor and Claude Desktop. Calypso is a hosted, Gemini File Search-powered multimodal RAG layer for grounded answers across PDFs, docs, screenshots, charts, diagrams, help content, FAQs, images, and internal knowledge.

Instead of wiring each agent or workflow to a one-off document search stack, use this MCP as the agent-facing entry point to one reusable answer layer: upload source material once, retrieve across text and visual content, and return answers with evidence users can verify.

Docs: [https://docs.calypso.so](https://docs.calypso.so)

## What you get

- **`calypso-rag-agent`**: sends each turn directly to the Calypso RAG agent and supports multi-turn context with `/new` reset
- **`calypso-upload-agent-file`**: uploads a file into the agent store and returns a compatible OpenAI-style `file_id`
- **`calypso-upload-knowledge-file`**: uploads durable knowledge files for indexing and retrieval

The server also exposes read-only MCP resources and reusable prompts so clients can discover safe workflows before calling tools.

## Why Multimodal-First RAG

Most company knowledge is not only text. The answer often lives across a setup screenshot, a PDF table, a product diagram, a help-center page, or a chart inside a report. Calypso packages that full knowledge surface into a single retrieval layer so agents can ask grounded questions without guessing from generic model memory.

- **Search the formats users actually rely on**: documentation, PDFs, screenshots, charts, diagrams, product images, support articles, manuals, policies, FAQs, and reports.
- **Ground answers before the model writes**: Gemini File Search retrieves relevant text and visual context first, then the RAG agent answers from that source material.
- **Show the evidence trail**: responses can include source references, page-aware grounding, and retrieval metadata so people can verify before they trust.
- **Scope retrieval with metadata**: use workspace, team, customer, language, file type, status, or other metadata to keep answers relevant without duplicating knowledge bases.
- **Reuse the same knowledge layer everywhere**: connect Cursor, Claude Desktop, AI agents, n8n workflows, product UI, support flows, and website experiences to the same source-backed layer.

In practice, this means your agent can answer questions like:

- "What does this onboarding PDF say about approval rules?"
- "Why is this setup screen failing?"
- "Summarize the policy that applies to this support ticket."
- "Which product plan fits this customer based on our pricing docs?"
- "Compare the diagrammed ingestion flow with the retrieval flow."

## Catalog & Trust

This repository is prepared for the [Archestra MCP Catalog](https://archestra.ai/mcp-catalog). The Trust Score badge is a catalog hygiene signal based on public metadata such as protocol coverage, documentation, GitHub activity, and code quality. It is not a security certification; review the code and configure API keys carefully before connecting any MCP server to sensitive data.

To add this server to Archestra, fork [`archestra-ai/website`](https://github.com/archestra-ai/website), edit `app/app/mcp-catalog/data/mcp-servers.json`, and add:

```json
"https://github.com/calypso-so/calypso-mcp-server"
```

## What this MCP does

With `calypso-rag-agent` you can:

- Ask grounded questions against the configured Calypso knowledge base
- Continue a multi-turn conversation via the native `/v1/responses` conversation model
- Reset the conversation context with `/new`
- Use the same OpenAI-compatible Responses endpoint that serves `calypso-rag-agent`
- Discover built-in resources and prompts for the supported Calypso workflows

## Requirements

- Node.js 18+
- A Calypso API endpoint that exposes:
  - `POST /v1/responses`
- A Calypso API key (`sk-...`)

## Configuration

Environment variables:

- `CALYPSO_API_KEY` (required)
- `CALYPSO_API_BASE_URL` (optional, default `https://api.calypso.so/v1`)

CLI flags:

- `--api-key`
- `--api-base-url`

Configuration precedence:

1. CLI flags / Smithery-provided command arguments
2. Environment variables
3. Default base URL (`https://api.calypso.so/v1`)

## Run with npx

```bash
npx -y @calypsohq/multimodal-rag-mcp-server --api-key "sk-..."
```

## Run with environment variables

```bash
env CALYPSO_API_KEY="sk-..." CALYPSO_API_BASE_URL="https://api.calypso.so/v1" npx -y @calypsohq/multimodal-rag-mcp-server
```

## Configure in Cursor

Add a new MCP server (command type) like:

```bash
npx -y @calypsohq/multimodal-rag-mcp-server --api-key sk-... --api-base-url https://api.calypso.so/v1
```

## Configure in Claude Desktop

### 1. Open Claude Desktop MCP config

In Claude Desktop:

`Claude -> Settings -> Developer -> Edit Config`

On macOS, the file is usually:

```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

Claude Desktop uses `claude_desktop_config.json` for desktop MCP servers. Claude Code uses separate config locations such as `~/.claude.json` or project-level `.mcp.json`.

### 2. Add the Calypso MCP server

Paste this into `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "Calypso Multimodal RAG": {
      "command": "npx",
      "args": [
        "-y",
        "@calypsohq/multimodal-rag-mcp-server"
      ],
      "env": {
        "CALYPSO_API_KEY": "sk-your-calypso-api-key",
        "CALYPSO_API_BASE_URL": "https://api.calypso.so/v1"
      }
    }
  }
}
```

Replace:

- `sk-your-calypso-api-key`

with your real Calypso API key.

### 3. Restart Claude Desktop fully

Fully quit Claude Desktop, then reopen it.

Do not only close the window. On macOS:

```bash
Cmd + Q
```

After restart, the MCP should appear in Claude with these tools available:

- `calypso-rag-agent`
- `calypso-upload-agent-file`
- `calypso-upload-knowledge-file`

## Smithery

The server is available on [Smithery](https://smithery.ai/servers/multimodal-rag/calypso-mcp-server) and launches through the same `npx` package path used by desktop clients.

Smithery user config:

- `calypsoApiKey` (required)
- `calypsoApiBaseUrl` (optional, defaults to `https://api.calypso.so/v1`)

The Smithery launch path is equivalent to:

```bash
npx -y @calypsohq/multimodal-rag-mcp-server --api-key sk-... --api-base-url https://api.calypso.so/v1
```

Use `calypsoApiBaseUrl` only when targeting a self-hosted Calypso-compatible deployment. The cloud default does not need an override.

## Troubleshooting

- **Missing API key**: provide `--api-key` or `CALYPSO_API_KEY`
- **Wrong API host**: make sure `--api-base-url` / `CALYPSO_API_BASE_URL` ends in `/v1`
- **Self-hosted deployment**: only override the base URL if you are not using `https://api.calypso.so/v1`
- **Smithery launch mismatch**: use the packaged `npx -y @calypsohq/multimodal-rag-mcp-server` path instead of running `node dist/index.js` from a fresh clone

## Available tools

### `calypso-rag-agent`
Direct Calypso RAG agent access.

Notes:
- It does not auto-route to other personas or agents.
- It uses `POST /v1/responses` instead of `POST /v1/chat/completions`.
- First turns create a named conversation, and follow-up turns chain with `previous_response_id`.
- Optional `fileIds` are attached as `input_file` parts and use `metadata._aicore.file_input_strategy = "rag_policy"` for retrieval-backed agent-store semantics.
- Use `/new` as the prompt to reset the MCP conversation.

### `calypso-upload-agent-file`
Uploads a file into the agent store and returns a compatible OpenAI-style `file_id`.

Notes:
- Sends `purpose=user_data` on the upload request.
- Sends `target_model` so the file lands in the intended agent store instead of a generic attachment path.
- Supports either `contentBase64` for remote execution or `filePath` for local desktop usage.
- Can optionally wait until the file is RAG-ready before returning.

### `calypso-upload-knowledge-file`
Uploads a file into the durable knowledge store and indexing pipeline.

Notes:
- Uses `POST /v1/knowledge/files`.
- Returns knowledge-file and task metadata, not a chat attachment `file_id`.
- Supports optional `title`, `tags`, `metadata`, and `idempotencyKey`.
- Can optionally wait until indexing reaches a ready state before returning.

## Available resources

### `calypso://server-info`
Read-only server metadata, including package version, API base URL, transport, authentication model, and exposed capabilities.

### `calypso://workflows`
A compact guide to the supported RAG, agent-file, and knowledge-file workflows.

### `calypso://security`
Operational security notes for API keys, local file reads, uploads, and logging.

## Available prompts

- **`calypso-knowledge-question`**: draft a grounded knowledge-base question for `calypso-rag-agent`
- **`calypso-agent-file-question`**: ask over uploaded `file_id` values using `rag_policy` semantics
- **`calypso-knowledge-ingestion`**: prepare a durable knowledge-store upload and follow-up query
- **`calypso-reset-conversation`**: start a clean RAG thread with `/new`

## Common workflows (copy/paste)

### Knowledge retrieval

- **Summarize a topic**:
  - `Summarize the knowledge base guidance for campaign approvals`
- **Ask for a specific answer**:
  - `What does our documentation say about indexing retries?`
- **Compare two concepts**:
  - `Compare file indexing with retrieval execution in the current architecture`
- **Start a fresh thread**:
  - `/new`

### Multi-turn follow-up

- **Refine a previous answer**:
  - `Focus only on the ingestion path and ignore retrieval`
- **Ask for sources or justification**:
  - `Explain which documented components are involved and why`

### Agent-store file flow

- **Upload a file for the RAG agent**:
  - Call `calypso-upload-agent-file` with `filename`, `mimeType`, and either `contentBase64` or `filePath`
- **Ask over the uploaded file**:
  - Call `calypso-rag-agent` with your `prompt` and the returned `fileIds`
- **RAG semantics**:
  - The MCP automatically uses `rag_policy` when `fileIds` are attached

### Knowledge-store file flow

- **Upload durable knowledge**:
  - Call `calypso-upload-knowledge-file` with the file payload and optional `title`, `tags`, or `metadata`
- **Wait for indexing**:
  - Pass `waitForIndexing: true` if you want the tool to block until the knowledge file is indexed

## Tips

- **Start over**: use `/new` to reset the MCP conversation (new `conversation_id` + cleared response chain).
