import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.join(repoRoot, "dist", "index.js");

const requiredTools = {
  "calypso-rag-agent": ["prompt"],
  "calypso-upload-agent-file": ["filename", "mimeType"],
  "calypso-upload-knowledge-file": ["filename", "mimeType"],
};

const requiredResources = [
  "calypso://server-info",
  "calypso://workflows",
  "calypso://security",
];

const requiredPrompts = [
  "calypso-knowledge-question",
  "calypso-agent-file-question",
  "calypso-knowledge-ingestion",
  "calypso-reset-conversation",
];

function assertRequiredTools(tools) {
  for (const [toolName, requiredProperties] of Object.entries(requiredTools)) {
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw new Error(
        `Smoke test failed: missing tool registration for ${toolName}`,
      );
    }

    for (const propertyName of requiredProperties) {
      if (!tool.inputSchema?.properties?.[propertyName]) {
        throw new Error(
          `Smoke test failed: ${toolName} is missing inputSchema property ${propertyName}`,
        );
      }
    }
  }
}

function assertRequiredResources(resources) {
  const resourceUris = new Set(resources.map((resource) => resource.uri));
  const missingResources = requiredResources.filter(
    (uri) => !resourceUris.has(uri),
  );
  if (missingResources.length > 0) {
    throw new Error(
      `Smoke test failed: missing resources ${missingResources.join(", ")}`,
    );
  }
}

function assertRequiredPrompts(prompts) {
  const promptNames = new Set(prompts.map((prompt) => prompt.name));
  const missingPrompts = requiredPrompts.filter(
    (promptName) => !promptNames.has(promptName),
  );
  if (missingPrompts.length > 0) {
    throw new Error(
      `Smoke test failed: missing prompts ${missingPrompts.join(", ")}`,
    );
  }
}

async function main() {
  const client = new Client({
    name: "calypso-smithery-smoke-test",
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });

  await client.connect(transport);

  try {
    const toolsResult = await client.listTools();
    assertRequiredTools(toolsResult.tools);

    const resourcesResult = await client.listResources();
    assertRequiredResources(resourcesResult.resources);

    const promptsResult = await client.listPrompts();
    assertRequiredPrompts(promptsResult.prompts);

    console.log("Smithery stdio smoke test passed.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
