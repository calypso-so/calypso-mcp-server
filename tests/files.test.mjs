import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { resolveUploadContent, stripDataUriPrefix } from "../dist/files.js";

test("stripDataUriPrefix removes data URI metadata", () => {
  assert.equal(
    stripDataUriPrefix("data:text/plain;base64,aGVsbG8="),
    "aGVsbG8=",
  );
  assert.equal(stripDataUriPrefix("aGVsbG8="), "aGVsbG8=");
});

test("resolveUploadContent decodes base64 content", async () => {
  const content = await resolveUploadContent({
    filename: "hello.txt",
    mimeType: "text/plain",
    contentBase64: "data:text/plain;base64,aGVsbG8=",
  });

  assert.equal(content.filename, "hello.txt");
  assert.equal(content.mimeType, "text/plain");
  assert.equal(Buffer.from(content.bytes).toString("utf8"), "hello");
});

test("resolveUploadContent reads local file paths", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "calypso-mcp-"));
  const filePath = path.join(tempDir, "local.txt");

  try {
    await writeFile(filePath, "local file");
    const content = await resolveUploadContent({
      mimeType: "text/plain",
      filePath,
    });

    assert.equal(content.filename, "local.txt");
    assert.equal(content.mimeType, "text/plain");
    assert.equal(Buffer.from(content.bytes).toString("utf8"), "local file");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveUploadContent requires exactly one content source", async () => {
  await assert.rejects(
    () =>
      resolveUploadContent({
        filename: "invalid.txt",
        mimeType: "text/plain",
      }),
    /Provide exactly one/,
  );

  await assert.rejects(
    () =>
      resolveUploadContent({
        filename: "invalid.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
        filePath: "/tmp/invalid.txt",
      }),
    /Provide exactly one/,
  );
});
