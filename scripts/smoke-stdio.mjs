import path from "path";
import { fileURLToPath } from "url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.join(repoRoot, "dist", "index.js");

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
    const requiredTools = [
      "calypso-rag-agent",
      "calypso-upload-agent-file",
      "calypso-upload-knowledge-file",
    ];
    const missingTools = requiredTools.filter((toolName) => !toolsResult.tools.some((tool) => tool.name === toolName));
    if (missingTools.length > 0) {
      throw new Error(`Smoke test failed: missing tool registrations for ${missingTools.join(", ")}`);
    }

    console.log("Smithery stdio smoke test passed.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
