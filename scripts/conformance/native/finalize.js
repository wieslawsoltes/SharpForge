import { access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { environmentReport } from "../env-report.js";
import { writeJSON, hash, json, readRegular } from "../repro/common.js";
import { selectedRows, contractDigest, specRevision } from "./contracts.js";
// Keep this module free of workspace-package imports: it must capture evidence
// even when npm ci or SDK installation failed. Existing captures are never replaced.
const [suite, version, platform, architecture] = process.argv.slice(2);
const directory = resolve(
  `artifacts/results/native/${platform}-${architecture}-${suite}-${version}`,
);
try {
  await access(join(directory, "bundle.json"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const env = environmentReport();
  const reason =
    "Native job produced no capture; inspect installation/setup and job logs";
  await writeJSON(join(directory, "env.json"), env);
  await writeJSON(join(directory, "report.json"), {
    schemaVersion: 1,
    contractDigest,
    specRevision,
    suite,
    version,
    platform,
    architecture,
    commit: env.commit,
    runId: env.github.runId,
    runAttempt: env.github.attempt,
    runKind: env.github.runId ? "github-actions" : "local",
    envSha256: hash(json(env)),
    sourceState: { before: null, after: null },
    commands: [],
    rows: selectedRows({ suite, version, platform, architecture }).map(
      (row) => ({
        ...row,
        status: "fail",
        gapId: "SF-A29-T10/" + row.id,
        unsupportedChecks: [],
        checks: [{ id: "setup-failure", status: "fail", reason }],
      }),
    ),
    benchmark: { status: "unknown", reason },
    passed: false,
  });
  await writeJSON(join(directory, "bundle.json"), {
    schemaVersion: 1,
    files: await Promise.all(
      ["env.json", "report.json"].map(async (path) => ({
        path,
        sha256: hash(await readRegular(join(directory, path))),
      })),
    ),
  });
  process.exitCode = 1;
}
