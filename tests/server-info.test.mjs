import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CALYPSO_TOOLS } from "../dist/config.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = readFileSync(join(repoRoot, "src/server.ts"), "utf8");

/**
 * The tools the server actually registers, read from the registration call
 * sites. server.registerTool's first argument is always a CALYPSO_* constant.
 */
function registeredToolConstants() {
  return [
    ...serverSource.matchAll(/server\.registerTool\(\s*([A-Z][A-Z0-9_]*)/g),
  ].map((match) => match[1]);
}

const configSource = readFileSync(join(repoRoot, "src/config.ts"), "utf8");

/** Resolve a CALYPSO_* constant name to its string value. */
function constantValue(name) {
  const match = configSource.match(
    new RegExp(`export const ${name} = "([^"]+)"`),
  );
  return match?.[1];
}

test("calypso://server-info advertises exactly the tools that are registered", () => {
  // Regression: calypso-add-website was registered but missing from the
  // server-info tools array, so an agent introspecting the server to discover
  // capabilities never learned URL ingestion existed.
  const registered = registeredToolConstants().map(constantValue);

  assert.ok(registered.length > 0, "expected to find registerTool call sites");
  for (const name of registered) {
    assert.ok(
      name,
      "every registered tool constant should resolve to a string",
    );
  }

  assert.deepEqual(
    [...CALYPSO_TOOLS].sort(),
    [...registered].sort(),
    "CALYPSO_TOOLS (used by calypso://server-info) must match the registered tools",
  );
});

test("every advertised tool name is namespaced and kebab-case", () => {
  for (const tool of CALYPSO_TOOLS) {
    assert.match(tool, /^calypso-[a-z0-9]+(-[a-z0-9]+)*$/, tool);
  }
});

test("the tool list has no duplicates", () => {
  assert.equal(new Set(CALYPSO_TOOLS).size, CALYPSO_TOOLS.length);
});

test("the legacy calypso-rag-agent tool name is gone", () => {
  assert.ok(!CALYPSO_TOOLS.includes("calypso-rag-agent"));
  assert.ok(
    !/LEGACY_AGENT_MODEL_FAMILY/.test(configSource),
    "legacy model family constant should be removed",
  );
});
