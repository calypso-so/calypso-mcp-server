# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of `@calypsohq/multimodal-rag-mcp-server`.

## Reporting a Vulnerability

Please report suspected vulnerabilities through GitHub Security Advisories for this repository, or contact the Calypso maintainers through the support channel listed in the project documentation.

Include:

- affected package version
- MCP client and operating system
- reproduction steps
- whether an API key, uploaded file, or local `filePath` was involved

Do not include real API keys, customer files, or private knowledge-base content in the report.

## API Keys

This server authenticates to Calypso with `CALYPSO_API_KEY` or the `--api-key` CLI flag. Treat that value as a secret:

- prefer environment variables or client secret stores over hard-coded config
- do not commit `.env` files or copied desktop MCP configs containing real keys
- rotate the key if it is exposed in logs, shell history, screenshots, or support tickets

The server does not intentionally log API keys. Error messages should be reviewed before sharing publicly because upstream API responses may include request-specific context.

## Local File Access

The upload tools accept either `contentBase64` or `filePath`.

- `contentBase64` is safest for remote or hosted MCP execution because the client provides the bytes directly.
- `filePath` is intended for local desktop use when the MCP process is allowed to read the selected path.

Only provide `filePath` values for files you intend to upload to Calypso. MCP clients should ask for user confirmation before calling upload tools with local paths.

## Upload Behavior

`calypso-upload-agent-file` uploads to the agent store for retrieval-backed chat attachment. `calypso-upload-knowledge-file` uploads durable knowledge files for indexing. Both send file contents to the configured Calypso API base URL.

Before using a self-hosted `CALYPSO_API_BASE_URL`, verify that it is trusted and ends in `/v1`.

## Logging

Operational logging should never include API keys or file contents. When adding logs, prefer event names, statuses, IDs, byte counts, and redacted URLs.
