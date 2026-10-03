import { readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readRegular, hash, writeJSON, isMain } from "../repro/common.js";
import {
  obligations,
  contractDigest,
  specRevision,
  pins,
  selectedRows,
  summarize,
  root,
  msbuildCheckIds,
  nativeIlCheckIds,
  hostCheckIds,
} from "./contracts.js";

const digest = /^[a-f0-9]{64}$/,
  commitPattern = /^[a-f0-9]{40}$/;
export function validateBundle(report, env, { commit, runId } = {}) {
  if (
    report.schemaVersion !== 1 ||
    report.contractDigest !== contractDigest ||
    report.specRevision !== specRevision
  )
    throw new Error("Unknown native report contract");
  if (
    !commitPattern.test(report.commit) ||
    report.commit !== env.commit ||
    (commit && report.commit !== commit)
  )
    throw new Error("Native report commit mismatch");
  if (
    (report.platform !== env.runner.os ||
      report.architecture !== env.runner.architecture) &&
    report.rows?.some((row) => row.status !== "fail")
  )
    throw new Error("Native report host mismatch");
  if (!env.runner.release || !env.node.version)
    throw new Error("Exact observed OS and Node versions required");
  if (report.runKind === "github-actions") {
    if (
      !/^\d+$/.test(report.runId || "") ||
      report.runId !== env.github.runId ||
      (runId && report.runId !== runId)
    )
      throw new Error("Native run ID mismatch");
    if (String(report.runAttempt) !== String(env.github.attempt))
      throw new Error("Native run attempt mismatch");
  } else if (
    report.runKind !== "local" ||
    report.runId !== null ||
    env.github.runId !== null ||
    runId
  )
    throw new Error("Local capture cannot qualify a hosted run");
  const expected = selectedRows(report);
  if (!Array.isArray(report.rows) || report.rows.length !== expected.length)
    throw new Error("Incomplete native cell report");
  const seen = new Set();
  for (const row of report.rows) {
    const definition = expected.find((item) => item.id === row.id);
    if (!definition || seen.has(row.id))
      throw new Error("Unexpected or duplicate native obligation");
    seen.add(row.id);
    for (const key of Object.keys(definition))
      if (row[key] !== definition[key])
        throw new Error("Native obligation fields differ");
    if (
      !Array.isArray(row.checks) ||
      !row.checks.length ||
      row.status !== summarize(row.checks)
    )
      throw new Error("Native status not supported by checks");
    const ids = new Set();
    for (const check of row.checks) {
      if (typeof check.id !== "string" || !check.id || ids.has(check.id))
        throw new Error("Invalid or repeated native check");
      ids.add(check.id);
      if (!["pass", "fail", "unsupported", "unknown"].includes(check.status))
        throw new Error("Invalid native check status");
      if (check.status !== "pass" && !check.reason)
        throw new Error("Nonpassing check needs a reason");
      if (
        check.status === "unsupported" &&
        (row.engine !== "process" ||
          ![
            "posix-sigterm-cooperatively-disposes",
            "real-directory-permission-failure-is-cli-exit-one",
          ].includes(check.id))
      )
        throw new Error(
          "This native capability has no declared unsupported exception",
        );
      if (
        check.status === "unsupported" &&
        check.id === "posix-sigterm-cooperatively-disposes" &&
        report.platform !== "win32"
      ) {
        throw new Error(
          "POSIX signal delivery is applicable on the declared non-Windows targets",
        );
      }
    }
    const required =
      row.engine === "native-il"
        ? nativeIlCheckIds()
        : row.engine === "native-msbuild"
          ? msbuildCheckIds
          : hostCheckIds[row.engine];
    if (
      row.status === "pass" &&
      (ids.size !== required.length || required.some((id) => !ids.has(id)))
    ) {
      throw new Error(
        "Passing observation lacks the exact required capability checks",
      );
    }
    if (
      row.status === "pass" &&
      (report.sourceState?.before !== "" || report.sourceState?.after !== "")
    ) {
      throw new Error(
        "Passing native observation requires a clean committed source tree",
      );
    }
    if (
      row.status === "pass" &&
      !row.runtime &&
      env.node.version !== "v" + row.version
    )
      throw new Error("Node matrix version mismatch");
  }
  const passed =
    report.rows.every((row) => ["pass", "unsupported"].includes(row.status)) &&
    report.benchmark?.status !== "fail";
  if (report.passed !== passed)
    throw new Error("Report aggregate status mismatch");
  return report;
}
export async function readBundle(directory, options) {
  const parse = async (name) =>
    JSON.parse(await readRegular(join(directory, name)));
  const bundle = await parse("bundle.json");
  if (
    bundle.schemaVersion !== 1 ||
    !Array.isArray(bundle.files) ||
    bundle.files.length !== 2
  )
    throw new Error("Invalid native bundle");
  const names = new Set();
  for (const file of bundle.files) {
    if (
      !["env.json", "report.json"].includes(file.path) ||
      names.has(file.path) ||
      !digest.test(file.sha256)
    )
      throw new Error("Invalid native bundle member");
    names.add(file.path);
    if (hash(await readRegular(join(directory, file.path))) !== file.sha256)
      throw new Error("Native bundle bytes changed");
  }
  const envBytes = await readRegular(join(directory, "env.json")),
    report = await parse("report.json");
  if (report.envSha256 !== hash(envBytes))
    throw new Error("Environment evidence digest mismatch");
  return {
    report: validateBundle(report, JSON.parse(envBytes), options),
    env: JSON.parse(envBytes),
    evidenceDigest: hash(await readRegular(join(directory, "bundle.json"))),
  };
}
export function matrixReport(bundles = []) {
  const observations = new Map();
  for (const bundle of bundles) {
    validateBundle(bundle.report, bundle.env);
    for (const row of bundle.report.rows) {
      if (observations.has(row.id))
        throw new Error("Duplicate platform observation: " + row.id);
      observations.set(row.id, {
        ...row,
        evidence: {
          commit: bundle.report.commit,
          runId: bundle.report.runId,
          runAttempt: bundle.report.runAttempt,
          runKind: bundle.report.runKind,
          evidenceDigest: bundle.evidenceDigest,
          runUrl: bundle.report.runId
            ? `https://github.com/wieslawsoltes/SharpForge/actions/runs/${bundle.report.runId}`
            : null,
          osVersion: bundle.env.runner.release,
          image: bundle.env.runner.image,
          imageVersion: bundle.env.runner.imageVersion,
          node: bundle.env.node.version,
          observedPlatform: bundle.env.runner.os,
          observedArchitecture: bundle.env.runner.architecture,
          sdk: row.runtime ? row.version : null,
        },
      });
    }
  }
  const rows = obligations().map(
    (definition) =>
      observations.get(definition.id) || {
        ...definition,
        status: "unknown",
        gapId: "SF-A29-T10/" + definition.id,
        reason: "No capture for this exact target/tool obligation",
        evidence: null,
      },
  );
  return {
    schemaVersion: 1,
    contractDigest,
    specRevision,
    task: "SF-A29-T10",
    measurements: bundles.map((bundle) => ({
      platform: bundle.report.platform,
      architecture: bundle.report.architecture,
      suite: bundle.report.suite,
      version: bundle.report.version,
      commit: bundle.report.commit,
      runId: bundle.report.runId,
      result: bundle.report.benchmark,
    })),
    rows,
    coverage: {
      total: rows.length,
      observed: observations.size,
      pass: rows.filter((row) => row.status === "pass").length,
      fail: rows.filter((row) => row.status === "fail").length,
      unknown: rows.filter((row) => row.status === "unknown").length,
      unsupported: rows.filter((row) => row.status === "unsupported").length,
    },
    inferredCompatibility: pins.targets.map((target) => ({
      ...target,
      status: "inferred",
      testedOsVersions: [
        ...new Set(
          rows
            .filter(
              (row) =>
                row.platform === target.platform &&
                row.architecture === target.architecture &&
                row.evidence,
            )
            .map((row) => row.evidence.osVersion),
        ),
      ],
      reason:
        "A runner label is a scheduling request; other OS/image versions have not been tested by these observations",
    })),
    unsupportedTargets: [
      {
        target: "browser",
        reason:
          "Native child processes and OS filesystem/ACL APIs are unavailable in the browser sandbox",
      },
      {
        target: "other-os-or-architecture",
        reason:
          "This qualification manifest declares only Linux/Windows/macOS x64 and arm64",
      },
    ],
    passed:
      rows.every((row) => ["pass", "unsupported"].includes(row.status)) &&
      bundles.every((bundle) => bundle.report.passed),
  };
}
export async function collectBundles(directory, options = {}) {
  const found = [];
  async function visit(path, depth = 0) {
    if (depth > 4) throw new Error("Native artifact nesting limit exceeded");
    if (!(await lstat(path)).isDirectory())
      throw new Error("Native evidence root must be a real directory");
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error("Native evidence must not contain symlinks");
      if (entry.isDirectory()) await visit(join(path, entry.name), depth + 1);
      else if (entry.name === "bundle.json")
        found.push(await readBundle(path, options));
    }
  }
  await visit(directory);
  return found;
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2),
    option = (name) => {
      const i = args.indexOf(name);
      return i < 0 ? null : args[i + 1];
    };
  const empty = args.includes("--empty");
  const matrix = matrixReport(
    empty
      ? []
      : await collectBundles(
          resolve(option("--input") || "artifacts/results/native"),
          {
            commit: option("--commit") || process.env.GITHUB_SHA,
            runId: option("--run-id") || process.env.GITHUB_RUN_ID,
          },
        ),
  );
  await writeJSON(
    resolve(
      root,
      option("--output") || "artifacts/results/native/platform-matrix.json",
    ),
    matrix,
  );
  console.log(JSON.stringify(matrix.coverage));
  if (!empty && !matrix.passed) process.exitCode = 1;
}
