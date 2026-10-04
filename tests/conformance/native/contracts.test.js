import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  matrixReport,
  validateBundle,
  readBundle,
} from "../../../scripts/conformance/native/matrix-report.js";
import {
  obligations,
  selectedRows,
  pins,
  contractDigest,
  specRevision,
  summarize,
  quantiles,
  hostCheckIds,
} from "../../../scripts/conformance/native/contracts.js";
import { filesystemChecks } from "../../../scripts/conformance/native/filesystem.js";
import { processChecks } from "../../../scripts/conformance/native/process.js";
import {
  temporary,
  writeJSON,
  hash,
  json,
} from "../../../scripts/conformance/repro/common.js";

// Constructed reports exercise parser contracts only. They are never committed to
// the capability matrix or described as actual native qualification evidence.
function parserFixture(platform = "linux") {
  const architecture = "x64",
    version = pins.nodes[0].version;
  const env = {
    commit: "a".repeat(40),
    runner: {
      os: platform,
      architecture,
      release: "test-kernel",
      image: "test-image",
      imageVersion: "test-version",
    },
    node: { version: "v" + version },
    github: { runId: "1234", attempt: "1" },
  };
  const checks = {
    filesystem: Object.keys(filesystemChecks),
    process: Object.keys(processChecks),
    "node-core": [
      "node/exact-node-and-npm-versions",
      "node/check",
      "node/test",
      "node/build",
    ],
  };
  const report = {
    schemaVersion: 1,
    contractDigest,
    specRevision,
    suite: "host",
    version,
    platform,
    architecture,
    commit: env.commit,
    runId: "1234",
    runAttempt: "1",
    runKind: "github-actions",
    envSha256: hash(json(env)),
    sourceState: { before: "", after: "" },
    benchmark: { status: "unknown", reason: "Parser fixture" },
    passed: true,
    rows: selectedRows({ suite: "host", platform, architecture, version }).map(
      (row) => ({
        ...row,
        status: "pass",
        checks: checks[row.engine].map((id) => ({ id, status: "pass" })),
      }),
    ),
  };
  return { report, env, evidenceDigest: "b".repeat(64) };
}
test("T10 denominator declares six independent OS/architecture targets and every exact tool cell", () => {
  assert.deepEqual(Object.keys(filesystemChecks), hostCheckIds.filesystem);
  assert.deepEqual(Object.keys(processChecks), hostCheckIds.process);
  const rows = obligations();
  assert.equal(rows.length, 60);
  assert.equal(new Set(rows.map((row) => row.id)).size, 60);
  for (const target of pins.targets) {
    const own = rows.filter(
      (row) =>
        row.platform === target.platform &&
        row.architecture === target.architecture,
    );
    assert.equal(own.length, 10);
    assert.deepEqual(
      [...new Set(own.filter((row) => row.runtime).map((row) => row.version))],
      pins.sdks.map((sdk) => sdk.version),
    );
  }
  assert.throws(
    () =>
      selectedRows({
        suite: "sdk",
        version: "8.0.x",
        platform: "linux",
        architecture: "x64",
      }),
    /Unregistered/,
  );
  assert.throws(
    () =>
      selectedRows({
        suite: "host",
        version: pins.nodes[0].version,
        platform: "linux",
        architecture: "ia32",
      }),
    /Unregistered/,
  );
});
test("T10 missing observations remain unknown; runner labels never imply an OS-version pass", () => {
  const matrix = matrixReport();
  assert.equal(matrix.passed, false);
  assert.equal(matrix.coverage.unknown, 60);
  assert(matrix.rows.every((row) => row.evidence === null && row.gapId));
  assert(
    matrix.inferredCompatibility.every(
      (row) => row.status === "inferred" && row.testedOsVersions.length === 0,
    ),
  );
});
test("T10 shared capability registry preserves every tool-specific unknown obligation", async () => {
  const registry = JSON.parse(
    await readFile(
      new URL(
        "../../../planning/contracts/platform-capabilities.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const revisions = JSON.parse(
    await readFile(
      new URL(
        "../../../planning/contracts/spec-revisions.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const evidence = JSON.parse(
    await readFile(
      new URL(
        "../../../planning/qualification/native/evidence.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(evidence, []);
  assert(revisions.revisions.some((revision) => revision.id === specRevision));
  const identities = registry.rows
    .flatMap((row) => {
      assert.equal(row.status, "unknown");
      return row.platforms.flatMap((platform) =>
        row.engines.flatMap((engine) =>
          row.specRevisions.map((revision) =>
            [row.id, row.leafId, platform, engine, revision].join("|"),
          ),
        ),
      );
    })
    .sort();
  assert.deepEqual(
    identities,
    obligations()
      .map((row) =>
        [
          row.capabilityId,
          row.leafId,
          row.platform + "-" + row.architecture,
          row.engine + "@" + row.version,
          specRevision,
        ].join("|"),
      )
      .sort(),
  );
});
test("T10 matrix retains exact run/commit/OS evidence and rejects duplicate independent cells", () => {
  const fixture = parserFixture(),
    matrix = matrixReport([fixture]);
  assert.equal(matrix.coverage.pass, 3);
  assert.equal(matrix.coverage.unknown, 57);
  const observed = matrix.rows.find((row) => row.evidence);
  assert.equal(observed.evidence.runId, "1234");
  assert.equal(observed.evidence.osVersion, "test-kernel");
  assert.equal(observed.evidence.commit, "a".repeat(40));
  assert.throws(() => matrixReport([fixture, fixture]), /Duplicate/);
});
test("T10 matrix rejects wrong host, version, run, commit, dirty source and generic passing claims", () => {
  for (const mutate of [
    (f) => (f.report.commit = "c".repeat(40)),
    (f) => (f.report.architecture = "arm64"),
    (f) => (f.env.node.version = "v26.0.0"),
    (f) => (f.report.runId = "5678"),
    (f) => (f.report.sourceState.after = " M product.js"),
    (f) => (f.report.rows[0].checks = [{ id: "generic test", status: "pass" }]),
    (f) => f.report.rows.push(f.report.rows[0]),
    (f) => (f.report.rows[0].checks[0].status = "invented"),
    (f) => {
      f.report.rows[0].checks[0].status = "unsupported";
      delete f.report.rows[0].checks[0].reason;
    },
  ]) {
    const fixture = parserFixture();
    mutate(fixture);
    assert.throws(() => validateBundle(fixture.report, fixture.env));
  }
  const fixture = parserFixture();
  assert.throws(
    () =>
      validateBundle(fixture.report, fixture.env, { commit: "c".repeat(40) }),
    /commit mismatch/,
  );
  assert.throws(
    () => validateBundle(fixture.report, fixture.env, { runId: "other" }),
    /run ID mismatch/,
  );
});
test("T10 unsupported checks require reasons and remain visible alongside supported observations", () => {
  assert.equal(summarize([{ status: "unsupported" }]), "unsupported");
  assert.equal(
    summarize([{ status: "fail" }, { status: "unsupported" }]),
    "fail",
  );
  assert.equal(
    summarize([{ status: "unknown" }, { status: "pass" }]),
    "unknown",
  );
  const fixture = parserFixture("win32");
  const signal = fixture.report.rows[2].checks.find(
    (check) => check.id === "posix-sigterm-cooperatively-disposes",
  );
  signal.status = "unsupported";
  signal.reason = "Deliberate parser boundary";
  const matrix = matrixReport([fixture]);
  assert(
    matrix.rows
      .find((row) => row.id === fixture.report.rows[2].id)
      .checks.some((row) => row.status === "unsupported"),
  );
});
test("T10 evidence digest rejects a one-byte environment mutation and missing members", () =>
  temporary(async (directory) => {
    const { report, env } = parserFixture();
    await writeJSON(join(directory, "env.json"), env);
    await writeJSON(join(directory, "report.json"), report);
    const files = [
      { path: "env.json", sha256: hash(json(env)) },
      { path: "report.json", sha256: hash(json(report)) },
    ];
    await writeJSON(join(directory, "bundle.json"), {
      schemaVersion: 1,
      files,
    });
    assert.equal((await readBundle(directory)).report.commit, report.commit);
    await writeFile(join(directory, "env.json"), json(env) + " ");
    await assert.rejects(readBundle(directory), /bytes changed/);
    await writeJSON(join(directory, "bundle.json"), {
      schemaVersion: 1,
      files: [files[0]],
    });
    await assert.rejects(readBundle(directory), /Invalid native bundle/);
  }));
test("T10 p95/p99 measurement requires enough finite correctness-gated samples", () => {
  assert.deepEqual(quantiles(Array.from({ length: 20 }, (_, i) => i + 1)), {
    p95: 19,
    p99: 20,
  });
  assert.throws(() => quantiles([1, 2]), /Twenty/);
  assert.throws(() => quantiles(Array(20).fill(NaN)), /finite/);
});
test("T10 workflow is explicit, serial and pins every matrix version", async () => {
  const source = await readFile(
    new URL("../../../.github/workflows/native.yml", import.meta.url),
    "utf8",
  );
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /workflow_call:/);
  assert.doesNotMatch(source, /^  (?:push|pull_request|schedule|merge_group):/m);
  assert.match(source, /node:\n    needs: sdk/);
  assert.equal((source.match(/max-parallel: 1/g) || []).length, 2);
  for (const pin of [...pins.nodes, ...pins.sdks])
    assert(
      source.includes(`'${pin.version}'`) ||
        source.includes(`"${pin.version}"`),
    );
  for (const target of pins.targets)
    assert(source.includes(`runner: ${target.runner}`));
  assert(!/pull_request_target|contents: write|id-token: write/.test(source));
});
