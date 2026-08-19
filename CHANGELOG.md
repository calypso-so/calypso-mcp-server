# Changelog

All notable changes to `@calypsohq/multimodal-rag-mcp-server` will be documented in this file.

## 2.0.0 - 2026-08-19

### Breaking

- Tool names drop the word "knowledge", matching the platform's buckets-first naming:
  - `calypso-list-knowledge-buckets` -> `calypso-list-buckets`
  - `calypso-upload-knowledge-file` -> `calypso-upload-file`
  - `calypso-upload-knowledge-files-batch` -> `calypso-upload-files-batch`
  - `calypso-rag-agent` is unchanged.
- The buckets resource moved with them: `calypso://knowledge-buckets` -> `calypso://buckets`.
- Prompts renamed on the same surface: `calypso-knowledge-question` -> `calypso-question`,
  `calypso-knowledge-ingestion` -> `calypso-ingestion`.
- Update any saved MCP client configurations, prompts, or workflows that reference
  the old tool names; there are no aliases.

## Unreleased

### Added

- Added `calypso-upload-knowledge-files-batch` for durable batch knowledge ingestion with bucket assignment.
- Added knowledge bucket assignment options for durable knowledge-file uploads.
- Added MCP Registry metadata and publishing automation for `io.github.calypso-so/multimodal-rag-mcp-server`.
- Added Archestra MCP Catalog Trust Score badge and catalog submission instructions.
- Added `SECURITY.md` covering API keys, local file reads, uploads, and logging.
- Added GitHub Actions CI for formatting, linting, typechecking, tests, build, stdio smoke, and MCPB validation.
- Added Biome linting and formatting scripts.
- Added Node test coverage for CLI/config parsing and upload content helpers.
- Added read-only MCP resources for server metadata, workflows, and security guidance.
- Added reusable MCP prompts for common Calypso knowledge retrieval, upload, and reset workflows.
- Added best-effort redacted MCP logging around tool calls.

### Changed

- Expanded stdio smoke coverage to validate tool schemas, resources, and prompts.
- Updated README documentation to accurately describe all exposed tools and protocol capabilities.
