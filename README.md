# Calypso RAG MCP Server

[![smithery badge](https://smithery.ai/badge/multimodal-rag/calypso-mcp-server)](https://smithery.ai/servers/multimodal-rag/calypso-mcp-server)

This MCP server exposes the **Calypso RAG agent** to MCP clients such as Cursor and Claude Desktop. It is a thin bridge to Calypso's OpenAI-compatible API and forwards every request to the `calypso-rag-agent` model.

Docs: `https://docs.calypso.ms/`

## What you get

- **`calypso-rag-agent`**: a single tool that sends each turn directly to the Calypso RAG agent

The tool accepts a single `prompt` argument.

## What this MCP does

With `calypso-rag-agent` you can:

- Ask grounded questions against the configured Calypso knowledge base
- Continue a multi-turn conversation via the native `/v1/responses` conversation model
- Reset the conversation context with `/new`
- Use the same OpenAI-compatible Responses endpoint that serves `calypso-rag-agent`

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
npx -y @calypso-rag/calypso-mcp --api-key "sk-..."
```

## Run with environment variables

```bash
env CALYPSO_API_KEY="sk-..." CALYPSO_API_BASE_URL="https://api.calypso.so/v1" npx -y @calypso-rag/calypso-mcp
```

## Configure in Cursor

Add a new MCP server (command type) like:

```bash
npx -y @calypso-rag/calypso-mcp --api-key sk-... --api-base-url https://api.calypso.so/v1
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
        "@calypso-rag/calypso-mcp"
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

This repo includes a [`smithery.yaml`](./smithery.yaml) manifest that launches the published package with CLI flags instead of relying on a prebuilt local `dist/` directory.

For local `.mcpb` publishing, Smithery capabilities are populated from a full MCP-style server card. This repo keeps that metadata in [`smithery.server-card.json`](./smithery.server-card.json) and publishes it with [`scripts/publish-smithery.mjs`](./scripts/publish-smithery.mjs), because MCPB `manifest.json` does not support the full `inputSchema` shape Smithery expects for capabilities.

Smithery user config:

- `calypsoApiKey` (required)
- `calypsoApiBaseUrl` (optional, defaults to `https://api.calypso.so/v1`)

The Smithery launch path is equivalent to:

```bash
npx -y @calypso-rag/calypso-mcp --api-key sk-... --api-base-url https://api.calypso.so/v1
```

Use `calypsoApiBaseUrl` only when targeting a self-hosted Calypso-compatible deployment. The cloud default does not need an override.

## Troubleshooting

- **Missing API key**: provide `--api-key` or `CALYPSO_API_KEY`
- **Wrong API host**: make sure `--api-base-url` / `CALYPSO_API_BASE_URL` ends in `/v1`
- **Self-hosted deployment**: only override the base URL if you are not using `https://api.calypso.so/v1`
- **Smithery launch mismatch**: use the packaged `npx -y @calypso-rag/calypso-mcp` path instead of running `node dist/index.js` from a fresh clone

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
