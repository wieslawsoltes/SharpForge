import { resolve, join } from 'node:path';
import { readRegular, hash, writeJSON } from '../repro/common.js';
import { doubleBuild, compareBuilds } from '../repro/double-build.js';

/** Compare an explicitly supplied release archive with its exact hash and release outputs. */
export async function reproduceArchive({
  root,
  archive,
  sha256,
  commit,
  reference,
  output,
  signal,
}) {
  if (
    !/^[a-f0-9]{64}$/.test(sha256 ?? '') ||
    !/^[a-f0-9]{40}$/.test(commit ?? '')
  )
    throw new Error('Exact source archive SHA-256 and commit are required');
  const bytes = await readRegular(resolve(archive), {
    maxBytes: 512 * 1024 * 1024,
  });
  if (hash(bytes) !== sha256)
    throw new Error('Source archive SHA-256 mismatch');
  const referenceBytes = await readRegular(resolve(reference), {
    maxBytes: 32 * 1024 * 1024,
  });
  const record = JSON.parse(referenceBytes),
    expected = record.build ?? record;
  if (
    (record.status && record.status !== 'passed') ||
    record.passed === false ||
    expected.commit !== commit ||
    !expected.outputs?.length ||
    !expected.golden?.examples?.length
  )
    throw new Error('Incomplete matching release reference');
  const actual = await doubleBuild({
    root,
    ref: commit,
    archive: resolve(archive),
    output,
    signal,
  });
  const comparison = compareBuilds(expected, actual);
  const report = {
    schemaVersion: 1,
    status: actual.passed && comparison.passed ? 'passed' : 'failed',
    archiveSha256: sha256,
    referenceSha256: hash(referenceBytes),
    commit,
    comparison,
    repeatedExtraction: actual,
    scope:
      'Exact archive, two extracted builds and trusted release hash comparison',
  };
  await writeJSON(join(output, 'release15-archive.json'), report);
  return report;
}
