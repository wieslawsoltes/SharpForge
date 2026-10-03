import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporary } from "../../../scripts/conformance/repro/common.js";
import { secretScan } from "../../../scripts/conformance/supply/secret-scan.js";
import { sha256 } from "../../../scripts/conformance/supply/files.js";

const source =
  "-----BEGIN " +
  "PRIVATE KEY-----\npublic-owned-fixture\n-----END " +
  "PRIVATE KEY-----\n";
const path = "tests/owned-key.pem";
const entry = {
  path,
  fileSHA256: sha256(source),
  rule: "private-key",
  reason:
    "Constructed public fixture for exception boundary regression; no native or signing qualification",
  source:
    "https://github.com/wieslawsoltes/SharpForge/blob/" +
    "a".repeat(40) +
    "/tests/fixture.md",
};
const policy = { schemaVersion: 1, exceptions: [entry] };
async function write(root, file, bytes) {
  const parts = file.split("/");
  parts.pop();
  await mkdir(join(root, ...parts), { recursive: true });
  await writeFile(join(root, file), bytes);
}
test("public fixture exception binds exact source path, full bytes and one rule", () =>
  temporary(async (root) => {
    await write(root, path, source);
    let result = await secretScan({ root, exceptions: policy });
    assert.equal(result.status, "pass");
    assert.equal(result.appliedExceptions.length, 1);
    assert.equal(result.appliedExceptions[0].fileSHA256, sha256(source));
    await write(root, "elsewhere.pem", source);
    result = await secretScan({ root, exceptions: policy });
    assert.equal(result.status, "fail");
    assert(
      result.findings.some(
        (finding) =>
          finding.path === "elsewhere.pem" && finding.rule === "private-key",
      ),
    );
    await write(root, path, source + "changed");
    result = await secretScan({ root, exceptions: policy });
    assert(
      result.findings.some(
        (finding) => finding.rule === "public-fixture-digest-mismatch",
      ),
    );
  }));
test("a reviewed private-key fixture cannot exempt tokens or built artifacts", () =>
  temporary(async (root) => {
    const token = "gh" + "p_" + "Ab12".repeat(9),
      bytes = source + token;
    await write(root, path, bytes);
    const exact = {
      schemaVersion: 1,
      exceptions: [{ ...entry, fileSHA256: sha256(bytes) }],
    };
    const result = await secretScan({ root, exceptions: exact });
    assert.equal(result.status, "fail");
    assert(result.findings.some((finding) => finding.rule === "github-token"));
    await write(root, "dist/tests/owned-key.pem", source);
    const built = await secretScan({
      root,
      built: ["dist"],
      exceptions: policy,
    });
    assert(
      built.findings.some(
        (finding) =>
          finding.path === "dist/tests/owned-key.pem" &&
          finding.rule === "private-key",
      ),
    );
  }));
test("public fixture policy rejects wildcards, traversal, broad rules and absent digests", () =>
  temporary(async (root) => {
    for (const change of [
      { path: "tests/*.pem" },
      { path: "../escape.pem" },
      { rule: "github-token" },
      { fileSHA256: "" },
    ]) {
      await assert.rejects(
        secretScan({
          root,
          exceptions: {
            schemaVersion: 1,
            exceptions: [{ ...entry, ...change }],
          },
        }),
        /SECRET_EXCEPTION|SUPPLY_PATH/,
      );
    }
    await assert.rejects(
      secretScan({
        root,
        exceptions: { schemaVersion: 1, exceptions: [entry, entry] },
      }),
      /SECRET_EXCEPTION/,
    );
  }));
