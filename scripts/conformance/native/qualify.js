import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { environmentReport } from "../env-report.js";
import { npmCli } from "../node-tools.js";
import { NativeWorkspace } from "../../../packages/msbuild/src/node.js";
import {
  run,
  temporary,
  writeJSON,
  hash,
  json,
  isMain,
  readRegular,
  git,
  abortIfNeeded,
} from "../repro/common.js";
import {
  root,
  pins,
  contractDigest,
  specRevision,
  selectedRows,
  summarize,
  observe,
  quantiles,
} from "./contracts.js";
import { filesystemChecks } from "./filesystem.js";
import { processChecks, cli as productCli } from "./process.js";
import { qualifySdk } from "./sdk.js";

async function hostMeasurements(signal) {
  return temporary(async (directory) => {
    const source = "class P { static int Main() { return 42; } }";
    await writeFile(join(directory, "Program.cs"), source);
    const workspace = await NativeWorkspace.open(directory),
      reads = [],
      processes = [],
      retainedHeap = [];
    for (let i = 0; i < 21; i++) {
      abortIfNeeded(signal);
      const heap = process.memoryUsage().heapUsed,
        start = performance.now();
      assert.equal((await workspace.read("Program.cs")).text, source);
      reads.push(performance.now() - start);
      retainedHeap.push(process.memoryUsage().heapUsed - heap);
      const result = await productCli(["check", "Program.cs"], directory, {
        signal,
      });
      assert.equal(result.exitCode, 0, result.stderr);
      processes.push(result.elapsedMs);
    }
    const series = (values) => ({
      coldMs: values[0],
      warmMs: values.slice(1),
      ...quantiles(values.slice(1)),
    });
    return {
      nativeWorkspaceRead: series(reads),
      cliCheck: series(processes),
      memory: {
        metric: "Node heapUsed delta, not allocated bytes",
        bytes: retainedHeap,
        actualAllocationBytes: {
          status: "unknown",
          reason: "No allocation profiler attached",
        },
      },
      correctness:
        "Every read and child exit checked; warm CLI samples are fresh processes",
    };
  });
}
async function hostCore(context) {
  const checks = [],
    npm = npmCli();
  assert(npm, "npm CLI entry point required");
  const command = async (args) => {
    const result = await run(process.execPath, [npm, ...args], {
      cwd: root,
      signal: context.signal,
      timeout: 1200000,
    });
    context.commands.push({
      argv: [process.execPath, npm, ...args],
      ...result,
    });
    return result;
  };
  checks.push(
    await observe("node/exact-node-and-npm-versions", async () => {
      assert.equal(process.versions.node, context.pin.version);
      assert.equal(
        (await command(["--version"])).stdout.trim(),
        context.pin.npm,
      );
      const manifest = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      );
      assert.equal(manifest.engines.node, ">=22");
    }),
  );
  if (!context.core)
    checks.push({
      id: "node/core-check-test-build",
      status: "unknown",
      reason:
        "Core capture deferred; invoke --core in integrated qualification",
    });
  else
    for (const script of ["check", "test", "build"]) {
      checks.push(
        await observe("node/" + script, () => command(["run", script])),
      );
    }
  return checks;
}
export async function qualify({
  suite,
  version,
  platform = process.platform,
  architecture = process.arch,
  output,
  signal,
  core = false,
  measure = false,
  failure = null,
} = {}) {
  const definitions = selectedRows({ suite, version, platform, architecture });
  const pin = (suite === "sdk" ? pins.sdks : pins.nodes).find(
    (item) => item.version === version,
  );
  const directory = resolve(
    root,
    output ||
      `artifacts/results/native/${platform}-${architecture}-${suite}-${version}`,
  );
  await mkdir(directory, { recursive: true });
  // Reuse the existing host inventory, captured after setup, not before SDK selection.
  const env = environmentReport();
  await writeJSON(join(directory, "env.json"), env);
  const context = { signal, core, pin, commands: [] };
  const report = {
    schemaVersion: 1,
    contractDigest,
    specRevision,
    suite,
    version,
    commit: env.commit,
    runId: env.github.runId,
    runAttempt: env.github.attempt,
    runKind: env.github.runId ? "github-actions" : "local",
    platform,
    architecture,
    envSha256: hash(json(env)),
    commands: context.commands,
    rows: [],
    sourceState: { before: null, after: null },
    benchmark: { status: "unknown", reason: "Measurement not requested" },
  };
  try {
    if (failure) throw new Error(failure);
    report.sourceState.before = await git(root, ["status", "--porcelain"]);
    assert.equal(
      report.sourceState.before,
      "",
      "Native capture requires a clean committed checkout",
    );
    assert.equal(
      process.platform,
      platform,
      "Requested OS must match the actual Node host",
    );
    assert.equal(
      process.arch,
      architecture,
      "Requested architecture must match the actual Node host",
    );
    if (suite === "sdk") {
      const result = await qualifySdk(pin, { signal, measure });
      report.commands = result.commands;
      report.benchmark = result.benchmark;
      for (const definition of definitions) {
        const checks = result.checks[definition.engine];
        report.rows.push({ ...definition, status: summarize(checks), checks });
      }
    } else {
      assert.equal(
        process.versions.node,
        pin.version,
        "Requested Node version must match the actual host",
      );
      const groups = { filesystem: filesystemChecks, process: processChecks };
      for (const definition of definitions) {
        const checks =
          definition.engine === "node-core" ? await hostCore(context) : [];
        for (const [id, callback] of Object.entries(
          groups[definition.engine] || {},
        )) {
          abortIfNeeded(signal);
          checks.push(await observe(id, callback));
        }
        report.rows.push({ ...definition, status: summarize(checks), checks });
      }
      if (measure)
        report.benchmark = await observe("host/measurements", () =>
          hostMeasurements(signal),
        );
    }
    report.sourceState.after = await git(root, ["status", "--porcelain"]);
    if (report.sourceState.after) {
      for (const row of report.rows) {
        row.checks.push({
          id: "tracked-output-mutation",
          status: "fail",
          reason: report.sourceState.after,
        });
        row.status = "fail";
      }
    }
  } catch (error) {
    report.error = error.stack;
    report.commands.push(...(error.commands ?? []));
    for (const row of report.rows) {
      row.status = "fail";
      row.checks.push({
        id: "qualification-infrastructure-failure",
        status: "fail",
        reason: error.message,
      });
    }
    for (const definition of definitions) {
      if (!report.rows.some((row) => row.id === definition.id))
        report.rows.push({
          ...definition,
          status: "fail",
          checks: [
            {
              id: "environment-or-process-failure",
              status: "fail",
              reason: error.message,
            },
          ],
        });
    }
  }
  report.rows = report.rows.map((row) => ({
    ...row,
    gapId: row.status === "pass" ? null : "SF-A29-T10/" + row.id,
    unsupportedChecks: row.checks
      .filter((check) => check.status === "unsupported")
      .map((check) => ({ id: check.id, reason: check.reason })),
  }));
  report.passed =
    report.rows.every((row) => ["pass", "unsupported"].includes(row.status)) &&
    report.benchmark.status !== "fail";
  await writeJSON(join(directory, "report.json"), report);
  await writeJSON(join(directory, "bundle.json"), {
    schemaVersion: 1,
    files: [
      {
        path: "env.json",
        sha256: hash(await readRegular(join(directory, "env.json"))),
      },
      {
        path: "report.json",
        sha256: hash(await readRegular(join(directory, "report.json"))),
      },
    ],
  });
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        directory,
        rows: report.rows.map(({ id, status, gapId }) => ({
          id,
          status,
          gapId,
        })),
      },
      null,
      2,
    ),
  );
  return report;
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (["--core", "--measure"].includes(flag)) options[flag.slice(2)] = true;
    else if (
      [
        "--suite",
        "--version",
        "--platform",
        "--architecture",
        "--output",
        "--failure",
      ].includes(flag) &&
      args[i + 1]
    )
      options[flag.slice(2)] = args[++i];
    else throw new Error("Unknown or missing qualification option: " + flag);
  }
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (!(await qualify({ ...options, signal: controller.signal })).passed)
      process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
