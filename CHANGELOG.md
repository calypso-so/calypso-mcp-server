# Changelog

All notable changes to `@calypsohq/multimodal-rag-mcp-server` will be documented in this file.

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
