import { resolve } from "node:path";
import {
  boundedRead,
  isMain,
  localPath,
  readJSON,
  repository,
  sha256,
  sourceExclusions,
  walkFiles,
} from "./files.js";

const publicFixtures = await readJSON(
  localPath(repository, "planning/qualification/supply/public-fixtures.json"),
);
function fixtureExceptions(policy) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.exceptions))
    throw new Error("SECRET_EXCEPTION: invalid policy");
  const records = new Map();
  for (const item of policy.exceptions) {
    localPath(repository, item.path);
    if (
      records.has(item.path) ||
      /[*?\[\]]/.test(item.path) ||
      item.rule !== "private-key" ||
      !/^[a-f0-9]{64}$/.test(item.fileSHA256) ||
      typeof item.reason !== "string" ||
      item.reason.length < 20 ||
      typeof item.source !== "string" ||
      !item.source.startsWith(
        "https://github.com/wieslawsoltes/SharpForge/blob/",
      )
    ) {
      throw new Error(
        "SECRET_EXCEPTION: exact reviewed path, file digest, private-key rule and provenance required",
      );
    }
    records.set(item.path, item);
  }
  return records;
}

const patterns = [
  [
    "github-token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g,
  ],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/g],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];
const assignedSecret =
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\s*[=:]\s*["']([^"'\r\n]{20,512})["']/gi;

/** Shannon entropy in bits per character, descriptive only. */
export function entropy(value) {
  const counts = new Map();
  for (const character of value)
    counts.set(character, (counts.get(character) || 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const frequency = count / value.length;
    result -= frequency * Math.log2(frequency);
  }
  return result;
}

/** Index line starts once so token-heavy files remain O(bytes + findings log lines). */
function lineIndex(text) {
  const starts = [0];
  for (let offset = 0; offset < text.length; offset++) {
    if (text.charCodeAt(offset) === 10) starts.push(offset + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
}

/** Return locations, rules and digests only. Fail closed on excess findings; never log matched values. */
export function scanText(text, path, { maxFindings = 10000 } = {}) {
  if (!Number.isSafeInteger(maxFindings) || maxFindings < 0)
    throw new Error("SECRET_LIMIT: invalid finding limit");
  const findings = [];
  const line = lineIndex(text);
  const add = (rule, value, offset) => {
    if (findings.length >= maxFindings)
      throw new Error("SECRET_LIMIT: too many findings");
    findings.push({ path, rule, line: line(offset), sha256: sha256(value) });
  };
  for (const [rule, expression] of patterns) {
    for (const match of text.matchAll(new RegExp(expression)))
      add(rule, match[0], match.index);
  }
  for (const match of text.matchAll(new RegExp(assignedSecret))) {
    const value = match[1];
    if (
      entropy(value) >= 3.5 &&
      /[A-Za-z]/.test(value) &&
      /[0-9+/=_-]/.test(value)
    ) {
      add("high-entropy-secret-assignment", value, match.index);
    }
  }
  return findings;
}

/** Scan source and explicitly supplied built roots, preserving every finding and bounded cancellation. */
export async function secretScan({
  root = repository,
  built = [],
  signal,
  maxTotalBytes = 512 * 1024 * 1024,
  maxFindings = 10000,
  exceptions = publicFixtures,
} = {}) {
  const reviewed = fixtureExceptions(exceptions),
    appliedExceptions = [];
  const inputs = (
    await walkFiles(root, { signal, exclude: sourceExclusions })
  ).map((path) => ({ root, path }));
  for (const directory of built) {
    const absolute = localPath(root, directory);
    for (const path of await walkFiles(absolute, { boundary: root, signal }))
      inputs.push({ root: absolute, path, prefix: directory });
  }
  let totalBytes = 0;
  const findings = [];
  for (const [index, input] of inputs.entries()) {
    signal?.throwIfAborted();
    const bytes = await boundedRead(localPath(input.root, input.path), {
      root,
      signal,
    });
    totalBytes += bytes.length;
    if (totalBytes > maxTotalBytes)
      throw new Error("SECRET_LIMIT: total scan size exceeded");
    const path = input.prefix ? input.prefix + "/" + input.path : input.path;
    const observed = scanText(bytes.toString("utf8"), path, {
      maxFindings: maxFindings - findings.length,
    });
    const exception = !input.prefix && reviewed.get(path);
    if (exception && sha256(bytes) === exception.fileSHA256) {
      findings.push(
        ...observed.filter((finding) => finding.rule !== exception.rule),
      );
      if (observed.some((finding) => finding.rule === exception.rule))
        appliedExceptions.push({ ...exception });
    } else {
      findings.push(...observed);
      if (exception) {
        if (findings.length >= maxFindings)
          throw new Error("SECRET_LIMIT: too many findings");
        findings.push({
          path,
          rule: "public-fixture-digest-mismatch",
          line: 1,
          sha256: sha256(bytes),
        });
      }
    }
    if (index % 16 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    schemaVersion: 1,
    status: findings.length ? "fail" : "pass",
    files: inputs.length,
    bytes: totalBytes,
    findings,
    appliedExceptions,
  };
}

if (isMain(import.meta.url)) {
  const result = await secretScan({
    root: resolve(process.argv[2] || repository),
    built: process.argv.slice(3),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "pass") process.exitCode = 1;
}
