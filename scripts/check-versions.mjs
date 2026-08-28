#!/usr/bin/env node
/**
 * Verifies every file that carries a version agrees with package.json.
 *
 * This existed only inside publish-mcp-registry.yml, and only for server.json.
 * That is too late and too narrow: manifest.json and package-lock.json could
 * drift freely, and the check ran at release time rather than on the pull
 * request that introduced the drift. v2.4.0 shipped to npm with server.json
 * still on 2.3.1, which blocked the registry publish and left the two channels
 * advertising different versions.
 *
 * Run with --fix to write package.json's version into every other surface.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const shouldFix = process.argv.includes("--fix");

const read = (file) => JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
const write = (file, value) =>
  writeFileSync(join(repoRoot, file), `${JSON.stringify(value, null, 2)}\n`);

const expected = read("package.json").version;

/**
 * Each surface names the file, a label for the error message, and how to read
 * and write the version within that file's shape.
 */
const surfaces = [
  {
    file: "manifest.json",
    label: "manifest.json version",
    get: (json) => json.version,
    set: (json, version) => {
      json.version = version;
    },
  },
  {
    file: "server.json",
    label: "server.json version",
    get: (json) => json.version,
    set: (json, version) => {
      json.version = version;
    },
  },
  {
    file: "server.json",
    label: "server.json packages[0].version",
    get: (json) => json.packages?.[0]?.version,
    set: (json, version) => {
      if (json.packages?.[0]) json.packages[0].version = version;
    },
  },
  {
    file: "package-lock.json",
    label: "package-lock.json version",
    get: (json) => json.version,
    set: (json, version) => {
      json.version = version;
    },
  },
  {
    file: "package-lock.json",
    label: 'package-lock.json packages[""].version',
    get: (json) => json.packages?.[""]?.version,
    set: (json, version) => {
      if (json.packages?.[""]) json.packages[""].version = version;
    },
  },
];

// Identity fields that must never drift either — the registry rejects a
// mismatch between the npm package name and the server's declared identity.
const identityChecks = () => {
  const pkg = read("package.json");
  const server = read("server.json");
  return [
    ["package.json name", pkg.name, "@calypsohq/multimodal-rag-mcp-server"],
    [
      "package.json mcpName",
      pkg.mcpName,
      "io.github.calypso-so/multimodal-rag-mcp-server",
    ],
    [
      "server.json name",
      server.name,
      "io.github.calypso-so/multimodal-rag-mcp-server",
    ],
    [
      "server.json packages[0].identifier",
      server.packages?.[0]?.identifier,
      "@calypsohq/multimodal-rag-mcp-server",
    ],
  ];
};

if (shouldFix) {
  const byFile = new Map();
  for (const surface of surfaces) {
    if (!byFile.has(surface.file)) byFile.set(surface.file, read(surface.file));
    surface.set(byFile.get(surface.file), expected);
  }
  for (const [file, json] of byFile) {
    write(file, json);
    console.log(`updated ${file} -> ${expected}`);
  }
  process.exit(0);
}

const failures = [];

for (const surface of surfaces) {
  const actual = surface.get(read(surface.file));
  if (actual !== expected) {
    failures.push(`${surface.label}: expected ${expected}, got ${actual}`);
  }
}

for (const [label, actual, want] of identityChecks()) {
  if (actual !== want) {
    failures.push(`${label}: expected ${want}, got ${actual}`);
  }
}

if (failures.length > 0) {
  console.error(`Version check failed against package.json ${expected}:\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nRun `npm run version:sync` to write package.json's version everywhere.",
  );
  process.exit(1);
}

console.log(`All version and identity fields agree at ${expected}.`);
