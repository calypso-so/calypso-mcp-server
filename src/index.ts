#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import {
  DEFAULT_CALYPSO_API_BASE_URL,
  formatUsage,
  parseCliOptions,
  resolveRuntimeConfig,
} from "./config.js";
import { createCalypsoMcpServer } from "./server.js";

type PackageInfo = {
  name: string;
  version: string;
};

const FALLBACK_PACKAGE_INFO: PackageInfo = {
  name: "@calypsohq/multimodal-rag-mcp-server",
  version: "0.0.0",
};

async function loadPackageInfo(): Promise<PackageInfo> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const packageJsonContent = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonContent) as Partial<PackageInfo>;

    return {
      name: packageJson.name || FALLBACK_PACKAGE_INFO.name,
      version: packageJson.version || FALLBACK_PACKAGE_INFO.version,
    };
  } catch {
    return FALLBACK_PACKAGE_INFO;
  }
}

// Start the server with stdio transport
async function main() {
  try {
    dotenv.config();

    const packageInfo = await loadPackageInfo();
    const cliOptions = parseCliOptions(process.argv.slice(2));

    if (cliOptions.help) {
      console.log(formatUsage(packageInfo.name));
      process.exit(0);
    }

    if (cliOptions.version) {
      console.log(packageInfo.version);
      process.exit(0);
    }

    const runtimeConfig = resolveRuntimeConfig({
      cli: cliOptions,
      env: process.env,
    });

    const server = createCalypsoMcpServer({
      config: runtimeConfig,
      packageInfo,
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      console.error(
        `Example: env CALYPSO_API_KEY=sk-... CALYPSO_API_BASE_URL=${DEFAULT_CALYPSO_API_BASE_URL} npx -y @calypsohq/multimodal-rag-mcp-server`,
      );
      console.error("");
      console.error(formatUsage());
    }
    process.exit(1);
  }
}

main();
