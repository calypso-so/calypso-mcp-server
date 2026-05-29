# Calypso RAG MCP Server

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

## Run with npx

```bash
env CALYPSO_API_KEY="sk-..." CALYPSO_API_BASE_URL="https://api.calypso.so/v1" npx -y calypso-mcp
```

## Configure in Cursor

Add a new MCP server (command type) like:

```bash
env CALYPSO_API_KEY=sk-... CALYPSO_API_BASE_URL=https://api.calypso.so/v1 npx -y calypso-mcp
```

## Available tools

### `calypso-rag-agent`
Direct Calypso RAG agent access.

Notes:
- It does not auto-route to other personas or agents.
- It uses `POST /v1/responses` instead of `POST /v1/chat/completions`.
- First turns create a named conversation, and follow-up turns chain with `previous_response_id`.
- Use `/new` as the prompt to reset the MCP conversation.

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

## Tips

 - **Start over**: use `/new` to reset the MCP conversation (new `conversation_id` + cleared response chain).
