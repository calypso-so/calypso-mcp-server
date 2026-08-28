# Changelog

All notable changes to `@calypsohq/multimodal-rag-mcp-server` will be documented in this file.

## 2.4.0

- **Renamed the ask tool `calypso-rag-agent` -> `calypso-agent`**, matching the canonical
  model family. MCP clients discover tools dynamically, so the new name reaches them on the
  next `tools/list`; saved prompts naming the old tool should be updated.
- The model catalog now takes its default from the discovery response instead of a hardcoded
  constant, so it tracks the API rather than drifting behind a rename.
- `calypso-rag-agent[:{agent_id}]` model ids passed by a caller are normalized to the
  canonical family, so existing prompts keep resolving.
- Tool descriptions, prompts, the model-discovery resource name, and error messages now say
  "Calypso agent". The `calypso://rag-agent-models` resource URI is unchanged — it is a
  published address.

## 2.3.1 - 2026-08-24

### Fixed

- `calypso-create-bucket` / `calypso-create-agent`: every successful create
  failed client-side with MCP `-32602` because the raw API payload was returned
  as `structuredContent` and validated strictly against the declared output
  schema, which the API response has outgrown. The structured part is now
  projected onto the declared keys; the full payload remains in the text
  content. Found by a live end-to-end pass.
- `calypso-upload-files-batch`: `batchIdempotencyKey` is now optional and
  auto-generated when omitted; pass a stable key to make a retried call replay
  the same durable batch.
- `server.json` version re-aligned with `package.json`/`manifest.json` (was
  stuck behind, which fails the MCP-registry publish workflow's metadata
  consistency gate).
- README: replaced the broken Smithery badge (the badge endpoint returns
  HTTP 500) with a static shield pointing at the same server page.

## 2.3.0 - 2026-08-24

### Added

- `calypso-search` — retrieval-only knowledge search: returns the chunks and
  sources an agent answer would cite, without a synthesized answer. Scope via
  agent model id or explicit buckets (ids/slugs, max 5).

## 2.2.0 - 2026-08-20

### Added

- `sourceUrl` on `calypso-upload-file` — server-side URL import for a single
  durable knowledge file.
- `calypso-add-website` — one-shot web-page ingestion (crawl + analysis +
  persist) into bucket-backed knowledge.

## 2.1.0 - 2026-08-19

### Added

- `calypso-get-file` — resolve `fileIds` into filename, mime type, size, and
  indexing status, with optional provider ground-truth verification
  (`verify=true` -> `?verify=gemini`).
- `calypso-create-bucket` — create an empty bucket (create-then-fill workflow);
  requires the backend's `POST /v1/knowledge/buckets` and the
  `knowledge:bucket:create` capability.
- `calypso-create-agent` — create a RAG agent variant bound to buckets; the
  response leads with the ready-to-use `model` handle. Requires the backend's
  `POST /v1/rag-agent/agents` and the `rag:agent:create` capability; the plan's
  agent cap surfaces as `agent_limit_reached`.
- Tool annotations on every tool (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) and `structuredContent` + `outputSchema`
  on the create tools.
- A "Provision a new agent end to end" workflow in `calypso://workflows`.

### Changed

- The model catalog is no longer a startup snapshot: `calypso://rag-agent-models`
  re-runs discovery on every read, and successful creates refresh the catalog and
  emit `tools/list_changed` + `resources/list_changed` notifications.
- The variant list is no longer baked into the `calypso-rag-agent` tool
  description (clients cache descriptions); the resource is the authoritative,
  refreshable list. Only the default model remains inline.
- `@modelcontextprotocol/sdk` upgraded to 1.30 (required for `registerTool`
  annotations, output schemas, and list-changed notifications).

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
