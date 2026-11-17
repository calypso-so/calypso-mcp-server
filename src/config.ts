import { z } from "zod";

// MCP tool name. Renamed from "calypso-rag-agent" in v2.4.0 to match the
// canonical model family; clients discover tools dynamically, so the rename
// reaches them on their next tools/list.
export const CALYPSO_AGENT = "calypso-agent";
export const CALYPSO_LIST_BUCKETS = "calypso-list-buckets";
export const CALYPSO_UPLOAD_FILE = "calypso-upload-file";
export const CALYPSO_UPLOAD_FILES_BATCH = "calypso-upload-files-batch";
export const CALYPSO_GET_FILE = "calypso-get-file";
export const CALYPSO_CREATE_BUCKET = "calypso-create-bucket";
export const CALYPSO_CREATE_AGENT = "calypso-create-agent";
export const CALYPSO_ADD_WEBSITE = "calypso-add-website";
export const CALYPSO_SEARCH = "calypso-search";

/**
 * Every tool this server registers, in the order clients see them.
 *
 * The calypso://server-info resource had its own hand-written copy of this list
 * and had fallen out of step — calypso-add-website was registered but missing
 * from it, so an agent introspecting the server never learned URL ingestion
 * existed. One list, asserted against the registrations in tests/server-info.
 */
export const CALYPSO_TOOLS = [
  CALYPSO_AGENT,
  CALYPSO_SEARCH,
  CALYPSO_LIST_BUCKETS,
  CALYPSO_GET_FILE,
  CALYPSO_UPLOAD_FILE,
  CALYPSO_UPLOAD_FILES_BATCH,
  CALYPSO_ADD_WEBSITE,
  CALYPSO_CREATE_BUCKET,
  CALYPSO_CREATE_AGENT,
] as const;

// Model ids are a different namespace from tool names — they only ever looked
// alike by coincidence, and the 2026-08 rename pulled them apart.
//
// `elephant-agent` is the canonical family the API advertises since Step 2 of
// the Elephant rename (2026-11-17). The two earlier families stay accepted by
// the API, so a saved prompt that names `calypso-agent:x` is folded onto the
// spelling discovery lists rather than rejected (3.1.0).
export const DEFAULT_AGENT_MODEL_ID = "elephant-agent";
export const AGENT_MODEL_FAMILIES = [
  DEFAULT_AGENT_MODEL_ID,
  "calypso-agent",
  "calypso-rag-agent",
] as const;

/**
 * Fold a knowledge-agent model id in any accepted family onto the canonical
 * `elephant-agent[:{agent_id}]` spelling. Anything else (blank, another
 * product's id, a malformed `family:` with no agent id) is returned trimmed
 * and unchanged, so the discovery check still decides.
 */
export function canonicalAgentModelId(value: string | undefined): string {
  const modelId = String(value || "").trim();
  for (const family of AGENT_MODEL_FAMILIES) {
    if (modelId === family) return DEFAULT_AGENT_MODEL_ID;
    const prefix = `${family}:`;
    if (modelId.startsWith(prefix)) {
      const agentId = modelId.slice(prefix.length).trim();
      return agentId ? `${DEFAULT_AGENT_MODEL_ID}:${agentId}` : modelId;
    }
  }
  return modelId;
}

export const DEFAULT_CALYPSO_API_BASE_URL = "https://api.calypso.so/v1";

const optionalString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

export const calypsoConfigSchema = z.object({
  apiKey: optionalString,
  apiBaseUrl: optionalString
    .pipe(z.string().url().endsWith("/v1").optional())
    .default(DEFAULT_CALYPSO_API_BASE_URL),
});

export type CalypsoRuntimeConfig = z.infer<typeof calypsoConfigSchema>;

export type CalypsoCliOptions = {
  apiKey?: string;
  apiBaseUrl?: string;
  help: boolean;
  version: boolean;
};

const CLI_FLAG_ALIASES: Record<
  string,
  keyof Omit<CalypsoCliOptions, "help" | "version">
> = {
  "api-key": "apiKey",
  "calypso-api-key": "apiKey",
  "api-base-url": "apiBaseUrl",
  "calypso-api-base-url": "apiBaseUrl",
};

function normalizeOptionalValue(value?: string | null): string | undefined {
  const trimmed = (value || "").trim();
  return trimmed || undefined;
}

function readFlagValue(
  flag: string,
  argv: string[],
  index: number,
): { value?: string; consumedNextArg: boolean } {
  if (flag.includes("=")) {
    const [, rawValue = ""] = flag.split(/=(.*)/s, 2);
    return { value: rawValue, consumedNextArg: false };
  }

  const nextArg = argv[index + 1];
  if (!nextArg || nextArg.startsWith("--")) {
    throw new Error(`Missing value for --${flag.replace(/^--/, "")}`);
  }

  return { value: nextArg, consumedNextArg: true };
}

export function parseCliOptions(argv: string[]): CalypsoCliOptions {
  const options: CalypsoCliOptions = {
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--version" || argument === "-v") {
      options.version = true;
      continue;
    }

    if (!argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const normalizedFlag = argument.slice(2).split("=")[0];
    const targetOption = CLI_FLAG_ALIASES[normalizedFlag];
    if (!targetOption) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const { value, consumedNextArg } = readFlagValue(argument, argv, index);
    options[targetOption] = normalizeOptionalValue(value);
    if (consumedNextArg) {
      index += 1;
    }
  }

  return options;
}

export function resolveRuntimeConfig(options: {
  cli: Pick<CalypsoCliOptions, "apiKey" | "apiBaseUrl">;
  env: NodeJS.ProcessEnv;
}): CalypsoRuntimeConfig {
  return calypsoConfigSchema.parse({
    apiKey:
      normalizeOptionalValue(options.cli.apiKey) ??
      normalizeOptionalValue(options.env.CALYPSO_API_KEY),
    apiBaseUrl:
      normalizeOptionalValue(options.cli.apiBaseUrl) ??
      normalizeOptionalValue(options.env.CALYPSO_API_BASE_URL),
  });
}

export function formatUsage(command = "calypso-mcp"): string {
  return [
    `Usage: ${command} [options]`,
    "",
    "Options:",
    "  --api-key <value>           Calypso API key",
    "  --api-base-url <value>      Calypso OpenAI-compatible base URL (must end in /v1)",
    "  --help                      Show help",
    "  --version                   Show version",
    "",
    "Environment variables:",
    "  CALYPSO_API_KEY             Required for upload/query tool calls",
    `  CALYPSO_API_BASE_URL        Optional, defaults to ${DEFAULT_CALYPSO_API_BASE_URL}`,
  ].join("\n");
}
