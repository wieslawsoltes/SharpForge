import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hash, json } from "../repro/common.js";
import { clrExecutionCases } from "../../../tests/clr-fixtures.js";
import { cilExecutionCases } from "../../../tests/cil-fixtures.js";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const pins = JSON.parse(
  await readFile(
    new URL(
      "../../../planning/qualification/native/toolchain.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
export const hostCheckIds = JSON.parse(
  await readFile(
    new URL(
      "../../../planning/qualification/native/checks.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
export const specRevision = "sharpforge-native-platform-v1";
export const msbuildCheckIds = [
  "msbuild/sdk-project-real-runtime-and-architecture",
  "msbuild/evaluate-preprocess-targets-and-artifacts",
  "msbuild/incremental-copy-and-negative-target",
  "msbuild/malformed-path-request-and-sdk-project",
  "msbuild/cancel-reaps-native-grandchildren-and-disposes",
  "msbuild/output-boundary-cancels-real-sdk",
];
export function nativeIlCheckIds() {
  return [
    ...clrExecutionCases.map(([name]) => "cil/" + name),
    ...cilExecutionCases.map(([name]) => "cil/console-" + name),
    "cil/malformed-native-image",
  ];
}
export const contractDigest = hash(
  json({
    pins,
    hostCheckIds,
    msbuildCheckIds,
    nativeIlCheckIds: nativeIlCheckIds(),
  }),
);
export class Unsupported extends Error {}
export function identity(target, engine, version) {
  return [target.platform, target.architecture, engine, version].join("/");
}
export function obligations() {
  return pins.targets.flatMap((target) => [
    ...pins.sdks.flatMap((sdk) =>
      ["native-il", "native-msbuild"].map((engine) => ({
        id: identity(target, engine, sdk.version),
        ...target,
        capabilityId: "platform." + engine,
        engine,
        version: sdk.version,
        runtime: sdk.runtime,
        leafId: "SF-A29-T10.1",
      })),
    ),
    ...pins.nodes.flatMap((node) =>
      ["node-core", "filesystem", "process"].map((engine) => ({
        id: identity(target, engine, node.version),
        ...target,
        capabilityId: "platform." + engine,
        engine,
        version: node.version,
        leafId:
          engine === "node-core"
            ? "SF-A29-T10.2"
            : engine === "filesystem"
              ? "SF-A29-T10.3"
              : "SF-A29-T10.4",
      })),
    ),
  ]);
}
export function selectedRows({
  platform = process.platform,
  architecture = process.arch,
  suite,
  version,
}) {
  const engines =
    suite === "sdk"
      ? ["native-il", "native-msbuild"]
      : suite === "host"
        ? ["node-core", "filesystem", "process"]
        : [];
  if (!engines.length) throw new Error("Suite must be sdk or host");
  const rows = obligations().filter(
    (row) =>
      row.platform === platform &&
      row.architecture === architecture &&
      row.version === version &&
      engines.includes(row.engine),
  );
  if (rows.length !== engines.length)
    throw new Error(
      "Unregistered platform, architecture or exact tool version",
    );
  return rows;
}
export function summarize(checks) {
  if (!checks.length) return "unknown";
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "unknown")) return "unknown";
  if (checks.every((check) => check.status === "unsupported"))
    return "unsupported";
  // A passing row covers applicable checks only. Every unsupported sub-capability
  // remains attached to the row and never becomes a passing observation.
  return "pass";
}
export async function observe(id, callback) {
  const start = performance.now();
  try {
    const detail = await callback();
    return {
      id,
      status: "pass",
      milliseconds: performance.now() - start,
      detail: detail ?? null,
    };
  } catch (error) {
    return {
      id,
      status: error instanceof Unsupported ? "unsupported" : "fail",
      milliseconds: performance.now() - start,
      reason: error.message,
      diagnostic: error.stack,
      process: error.result ?? null,
    };
  }
}
export function quantiles(values) {
  if (
    values.length < 20 ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error("Twenty finite nonnegative warm samples required");
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
  };
}
