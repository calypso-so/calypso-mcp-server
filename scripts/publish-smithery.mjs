import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Smithery from "@smithery/api";

const DEFAULT_QUALIFIED_NAME = "multimodal-rag/calypso-mcp-server";
const DEFAULT_BUNDLE_PATH = "server.mcpb";

function parseArgs(argv) {
  const options = {
    bundle: DEFAULT_BUNDLE_PATH,
    name: DEFAULT_QUALIFIED_NAME,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--bundle" || argument === "-b") {
      options.bundle = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--name" || argument === "-n") {
      options.name = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.bundle) {
    throw new Error("Missing value for --bundle");
  }

  if (!options.name) {
    throw new Error("Missing value for --name");
  }

  return options;
}

function formatUsage() {
  return [
    "Usage: node scripts/publish-smithery.mjs [options]",
    "",
    "Options:",
    `  -n, --name <value>     Smithery qualified server name (default: ${DEFAULT_QUALIFIED_NAME})`,
    `  -b, --bundle <path>    MCPB bundle path (default: ${DEFAULT_BUNDLE_PATH})`,
    "  -h, --help             Show help",
  ].join("\n");
}

function buildConfigSchema(userConfig) {
  const schema = {
    type: "object",
    properties: {},
  };

  const required = [];

  for (const [key, value] of Object.entries(userConfig || {})) {
    const property = {
      type:
        value.type === "file" || value.type === "directory"
          ? "string"
          : value.type,
    };

    if (value.title) {
      property.title = value.title;
    }

    if (value.description) {
      property.description = value.description;
    }

    if (value.default !== undefined) {
      property.default = value.default;
    }

    schema.properties[key] = property;

    if (value.required) {
      required.push(key);
    }
  }

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(formatUsage());
    process.exit(0);
  }

  const apiKey = process.env.SMITHERY_API_KEY;
  if (!apiKey) {
    throw new Error("SMITHERY_API_KEY is required to publish to Smithery");
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");

  const manifestPath = path.join(repoRoot, "manifest.json");
  const serverCardPath = path.join(repoRoot, "smithery.server-card.json");
  const bundlePath = path.resolve(repoRoot, options.bundle);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const serverCard = JSON.parse(fs.readFileSync(serverCardPath, "utf8"));

  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Bundle not found: ${bundlePath}`);
  }

  const payload = {
    type: "stdio",
    runtime: manifest.server?.type || "node",
    configSchema: buildConfigSchema(manifest.user_config),
    serverCard: {
      ...serverCard,
      serverInfo: {
        name: manifest.name,
        version: manifest.version,
        ...serverCard.serverInfo,
      },
    },
  };

  const client = new Smithery({ apiKey });
  const response = await client.servers.releases.deploy(options.name, {
    payload: JSON.stringify(payload),
    bundle: fs.createReadStream(bundlePath),
  });

  console.log(`Release ${response.deploymentId} accepted`);
  console.log(`MCP URL: ${response.mcpUrl}`);
  console.log(`Server Page: https://smithery.ai/servers/${options.name}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
