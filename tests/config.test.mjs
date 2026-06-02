import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_CALYPSO_API_BASE_URL,
  formatUsage,
  parseCliOptions,
  resolveRuntimeConfig,
} from "../dist/config.js";

test("parseCliOptions supports aliases and inline values", () => {
  assert.deepEqual(
    parseCliOptions([
      "--calypso-api-key=sk-test",
      "--calypso-api-base-url",
      "https://example.com/v1",
    ]),
    {
      apiKey: "sk-test",
      apiBaseUrl: "https://example.com/v1",
      help: false,
      version: false,
    },
  );
});

test("parseCliOptions rejects unknown arguments", () => {
  assert.throws(() => parseCliOptions(["--unknown"]), /Unknown argument/);
});

test("resolveRuntimeConfig prefers CLI over environment and applies default base URL", () => {
  assert.deepEqual(
    resolveRuntimeConfig({
      cli: { apiKey: "sk-cli" },
      env: {
        CALYPSO_API_KEY: "sk-env",
        CALYPSO_API_BASE_URL: "",
      },
    }),
    {
      apiKey: "sk-cli",
      apiBaseUrl: DEFAULT_CALYPSO_API_BASE_URL,
    },
  );
});

test("resolveRuntimeConfig validates base URL shape", () => {
  assert.throws(
    () =>
      resolveRuntimeConfig({
        cli: { apiBaseUrl: "https://example.com/api" },
        env: {},
      }),
    /Invalid input/,
  );
});

test("formatUsage includes command, flags, and environment variables", () => {
  const usage = formatUsage("calypso-mcp");

  assert.match(usage, /Usage: calypso-mcp/);
  assert.match(usage, /--api-key/);
  assert.match(usage, /CALYPSO_API_BASE_URL/);
});
