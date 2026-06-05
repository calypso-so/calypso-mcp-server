# Calypso Multimodal RAG MCP Server

**The easiest hosted multimodal RAG MCP server** for Claude Desktop, Cursor, and agent workflows.

One `npx` command. Gemini File Search-powered. Handles PDFs, screenshots, charts, diagrams, and images **natively** with verifiable citations.

[![smithery badge](https://smithery.ai/badge/multimodal-rag/calypso-mcp-server)](https://smithery.ai/servers/multimodal-rag/calypso-mcp-server)
[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/calypso-so/calypso-mcp-server)](https://archestra.ai/mcp-catalog/calypso-so__calypso-mcp-server)
[![npm version](https://img.shields.io/npm/v/@calypsohq/multimodal-rag-mcp-server)](https://www.npmjs.com/package/@calypsohq/multimodal-rag-mcp-server)
[![GitHub stars](https://img.shields.io/github/stars/calypso-so/calypso-mcp-server?style=social)](https://github.com/calypso-so/calypso-mcp-server)
[![Multimodal RAG](https://img.shields.io/badge/Multimodal_RAG-Gemini_File_Search-blue)](https://docs.calypso.so)
[![One command](https://img.shields.io/badge/One_Command-npx-success)](https://www.npmjs.com/package/@calypsohq/multimodal-rag-mcp-server)
[![License](https://img.shields.io/github/license/calypso-so/calypso-mcp-server)](./LICENSE)
[![CI](https://github.com/calypso-so/calypso-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/calypso-so/calypso-mcp-server/actions/workflows/ci.yml)

> The easiest way to add **hosted multimodal RAG** to Claude, Cursor, Windsurf, and custom agents.

- **Super simple setup**: `npx -y @calypsohq/multimodal-rag-mcp-server --api-key sk-your-key-here`
- **True multimodal RAG**: handles text and visuals natively through Gemini File Search
- **Upload and query**: dedicated tools for agent files, durable knowledge files, and batch uploads
- **Multi-turn conversations**: context-aware answers with `/new` reset
- **Discoverable workflows**: resources and prompts for safe RAG, upload, and ingestion flows

[GitHub](https://github.com/calypso-so/calypso-mcp-server) | [Docs](https://docs.calypso.so) | [Smithery](https://smithery.ai/servers/multimodal-rag/calypso-mcp-server) | [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.calypso-so/multimodal-rag-mcp-server)

Tags: `multimodal-rag`, `easiest-mcp-rag`, `gemini-rag`, `hosted-rag-mcp`, `mcp-server`

Instead of wiring each agent or workflow to a one-off document search stack, use this MCP as the agent-facing entry point to one reusable answer layer: upload source material once, retrieve across text and visual content, and return answers with evidence users can verify.

## Quick Start (Easiest)

```bash
# One-liner with npx
npx -y @calypsohq/multimodal-rag-mcp-server --api-key "sk-your-key-here"
```

Or with environment variables:

```bash
CALYPSO_API_KEY="sk-..." npx -y @calypsohq/multimodal-rag-mcp-server
```

Then add the same command to Claude Desktop, Cursor, or Smithery using the configuration examples below.

## Why Choose Calypso

Calypso is built for teams that want the easiest hosted multimodal RAG MCP server: no local vector stack, no Docker compose, and no custom OCR or image-processing pipeline before agents can ask grounded questions.

| Feature | Calypso | rag-anything-mcp | Pixeltable |
| --- | --- | --- | --- |
| **Setup** | 1 npx command (zero infra) | Clone + Python | Docker Compose |
| **Multimodal** | Native Gemini File Search (text + images, charts, diagrams, PDFs) with no extra vision pipeline | Strong OpenAI vision-based document RAG | Excellent for video, audio, images, and tables |
| **Hosting** | Fully hosted (self-host option) | Local-first | Local-first |
| **Operations** | Zero-ops cloud | Requires Python setup | Requires Docker |
| **Upload tools** | Built-in single file, durable knowledge file, and batch upload tools | Yes | Yes |
| **Citations / grounding** | Strong evidence trail with retrieval metadata | Yes | Yes |
| **Best for** | Teams wanting zero-ops hosted multimodal RAG for MCP clients | Local document RAG experiments | Heavy local video/audio/data workflows |

**Start here if you want the easiest hosted multimodal RAG MCP server.**

## What you get

- Production multimodal RAG agent with multi-turn memory
- Built-in upload tools for single files, batch uploads, and agent files
- Automatic discovery of your team's RAG variants and knowledge buckets
- Verifiable citations with source references and retrieval metadata
- Read-only resources and reusable prompts for safe workflows

## Why Multimodal-First RAG

Most company knowledge is not only text. The answer often lives across a setup screenshot, a PDF table, a product diagram, a help-center page, or a chart inside a report. Calypso packages that full knowledge surface into a single retrieval layer so agents can ask grounded questions without guessing from generic model memory.

- **Search the formats users actually rely on**: documentation, PDFs, screenshots, charts, diagrams, product images, support articles, manuals, policies, FAQs, and reports.
- **Ground answers before the model writes**: Gemini File Search retrieves relevant text and visual context first, then the RAG agent answers from that source material.
- **Show the evidence trail**: responses can include source references, page-aware grounding, and retrieval metadata so people can verify before they trust.
- **Scope retrieval with metadata**: use workspace, team, customer, language, file type, status, or other metadata to keep answers relevant without duplicating knowledge bases.
- **Reuse the same knowledge layer everywhere**: connect Cursor, Claude Desktop, AI agents, n8n workflows, product UI, support flows, and website experiences to the same source-backed layer.

In practice, this means your agent can answer questions like:

- "Explain this setup screenshot and the attached policy PDF. What should the support rep do next?"
- "What does this onboarding PDF say about approval rules?"
- "Why is this setup screen failing?"
- "Compare the pricing chart with our plan documentation and recommend the right tier."
- "Summarize the policy that applies to this support ticket."
- "Which product plan fits this customer based on our pricing docs?"
- "Compare the diagrammed ingestion flow with the retrieval flow."

## What this MCP does

With `calypso-rag-agent` you can:

- Ask grounded questions against the configured Calypso knowledge base
- Select any discovered team RAG variant with the optional `model` argument
- Continue a multi-turn conversation via the native `/v1/responses` conversation model
- Reset the conversation context with `/new`
- Use the same OpenAI-compatible Responses endpoint that serves `calypso-rag-agent`
- Discover built-in resources and prompts for the supported Calypso workflows

## Requirements

- Node.js 18+
- A Calypso API endpoint that exposes:
  - `POST /v1/responses`
  - `GET /v1/rag-agent/models`
  - `GET /v1/knowledge/buckets`
  - `POST /v1/files`
  - `POST /v1/knowledge/files`
  - `POST /v1/knowledge/files:batch`
  - `GET /v1/knowledge/batches/{batch_id}`
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
- `calypso-list-knowledge-buckets`
- `calypso-upload-agent-file`
- `calypso-upload-knowledge-file`
- `calypso-upload-knowledge-files-batch`

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
- It automatically discovers the API key's available `calypso-rag-agent` variants at startup.
- Use the optional `model` argument to choose a named variant such as `calypso-rag-agent:pricing`.
- Each model variant keeps its own MCP conversation chain, so switching variants does not continue the wrong thread.
- It uses `POST /v1/responses` instead of `POST /v1/chat/completions`.
- First turns create a named conversation, and follow-up turns chain with `previous_response_id`.
- Optional `fileIds` are supported for compatibility, but new agent-file uploads are bucket-backed and should be indexed into the selected model bucket before asking.
- Use `/new` as the prompt to reset the MCP conversation.

### `calypso-list-knowledge-buckets`
Lists knowledge buckets for the team tied to the configured Calypso API key.

Notes:
- Uses `GET /v1/knowledge/buckets`.
- Does not accept `team_id`; Calypso derives team scope from the API key.
- Returns bucket ids, slugs, names, status, member counts, source counts, and bucket-store readiness.
- Defaults to active buckets only. Pass `includeArchived: true` when you need archived buckets for audits or cleanup.
- Use this before `calypso-upload-knowledge-file`, `calypso-upload-knowledge-files-batch`, or `calypso-upload-agent-file` when you need to choose a destination bucket.
- `calypso://rag-agent-models` answers which buckets are bound to each RAG variant. `calypso-list-knowledge-buckets` answers which buckets exist for the API key's team.

Example:

```json
{
  "includeArchived": false
}
```

### `calypso-upload-agent-file`
Uploads a file through the agent-facing `/v1/files` API, backed by exactly one durable knowledge bucket, and returns a compatible OpenAI-style `file_id`.

Notes:
- Sends `purpose=user_data` on the upload request.
- Sends `target_model` so the upload is routed to the intended RAG variant.
- Sends `bucket_id` so the durable knowledge file lands in the selected bucket.
- If the selected model has one active bucket, the MCP auto-selects that bucket.
- If the selected model has multiple active buckets, pass `bucketId`.
- If the selected model has no active buckets, bind that agent variant to a knowledge bucket before uploading.
- Supports either `contentBase64` for remote execution or `filePath` for local desktop usage.
- Can optionally wait until the file is RAG-ready before returning.

Example:

```json
{
  "filename": "contract.pdf",
  "mimeType": "application/pdf",
  "filePath": "/Users/me/Desktop/contract.pdf",
  "targetModel": "calypso-rag-agent:legal",
  "bucketId": "bucket_abc123",
  "waitForReady": true
}
```

Read `calypso://rag-agent-models` to inspect each discovered model's `buckets` array before choosing `bucketId`.

### `calypso-upload-knowledge-file`
Uploads a file into the durable bucket-backed knowledge store and indexing pipeline.

Notes:
- Uses `POST /v1/knowledge/files`.
- Returns knowledge-file and task metadata, not a chat attachment `file_id`.
- Requires one bucket destination via `bucketIds`, `bucketSlugs`, or `bucket`.
- Supports optional `title`, `tags`, `metadata`, and `idempotencyKey`.
- Route uploads into existing buckets with `bucketIds` or `bucketSlugs`, or use `bucket` as a single-slug shortcut.
- Pass `createMissingBuckets: true` with bucket slugs when you want Calypso to create missing destinations during upload.
- Can optionally wait until indexing reaches a ready state before returning.

Example:

```json
{
  "filename": "handbook.pdf",
  "mimeType": "application/pdf",
  "filePath": "/Users/me/Desktop/handbook.pdf",
  "bucket": "support-handbook",
  "createMissingBuckets": true,
  "waitForIndexing": true
}
```

### `calypso-upload-knowledge-files-batch`
Uploads 1 to 100 files into the durable knowledge store in one request.

Notes:
- Uses `POST /v1/knowledge/files:batch` with a JSON manifest plus one multipart file part per item.
- Requires `batchIdempotencyKey`; Calypso uses it to derive the durable batch id for retries.
- Requires a shared bucket destination via `bucketIds`, `bucketSlugs`, or `bucket`, unless every item provides its own bucket destination.
- Supports shared `bucketIds`, `bucketSlugs`, `bucket`, and `createMissingBuckets` defaults, plus per-item overrides.
- Generates Firestore-safe `client_file_id` values when `clientFileId` is omitted.
- Supports `dryRun: true` to validate manifest and bucket behavior without storing files.
- `accepted` or `queued` means the upload is durable, not necessarily query-ready. Use `waitForBatchReady: true` to poll `GET /v1/knowledge/batches/{batch_id}?include_items=true`.
- Inspect per-item status, `bucketSyncStatus`, and `bucketSync` to distinguish indexed content from bucket-ready retrieval.

Example:

```json
{
  "batchIdempotencyKey": "kb-seed-2026-06-04",
  "bucket": "support-handbook",
  "createMissingBuckets": true,
  "items": [
    {
      "filename": "faq.txt",
      "mimeType": "text/plain",
      "filePath": "/Users/me/Desktop/faq.txt"
    }
  ],
  "waitForBatchReady": true
}
```

## Available resources

### `calypso://server-info`
Read-only server metadata, including package version, API base URL, transport, authentication model, and exposed capabilities.

### `calypso://rag-agent-models`
Read-only runtime catalog of team-scoped `calypso-rag-agent` model variants discovered from the configured API key, including each variant's active `buckets`, `bucket_ids`, and `missing_bucket_ids`. If discovery is unavailable, this resource falls back to the base `calypso-rag-agent`.

### `calypso://knowledge-buckets`
Read-only runtime list of knowledge buckets for the team tied to the configured API key. Use it to inspect bucket ids/slugs and bucket-store readiness before uploads.

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

- **Discover buckets**:
  - Call `calypso-list-knowledge-buckets` or read `calypso://knowledge-buckets` before choosing a destination
- **Upload durable knowledge**:
  - Call `calypso-upload-knowledge-file` with the file payload and optional `title`, `tags`, or `metadata`
- **Route knowledge into buckets**:
  - Use `bucket: "support-handbook"` for one destination, `bucketSlugs` for multiple slug-based destinations, or `bucketIds` when you already have stable bucket ids
- **Create bucket destinations on demand**:
  - Add `createMissingBuckets: true` when using slug-based bucket assignment and the destination may not exist yet
- **Wait for indexing**:
  - Pass `waitForIndexing: true` if you want the tool to block until the knowledge file is indexed

### Knowledge-store batch flow

- **Upload many durable files**:
  - Call `calypso-upload-knowledge-files-batch` with `items`, `batchIdempotencyKey`, and either `contentBase64` or `filePath` per item
- **Route the batch into buckets**:
  - Put shared `bucket`, `bucketSlugs`, `bucketIds`, or `createMissingBuckets` on the tool call, then override per item only when needed
- **Validate first**:
  - Use `dryRun: true` before large ingestions to catch manifest, bucket, or file-part issues
- **Wait for query readiness**:
  - Use `waitForBatchReady: true` and inspect returned item status plus bucket sync fields before querying fresh content

## Tips

- **Start over**: use `/new` to reset the MCP conversation (new `conversation_id` + cleared response chain).
