import {resolve} from 'node:path';
import {runProcess} from '../oracle/process.js';
import {verifyManifest} from '../source-manifest.js';
import {boundedRead, commit, isMain, localPath, readJSON, repository, sha256, writeJSON} from './files.js';

/** Exact release subject list, after verifying the original payload manifest. */
export async function releaseSubjects({root = repository} = {}) {
  const directory = resolve(root, 'artifacts');
  const manifest = await readJSON(resolve(directory, 'SOURCE-MANIFEST.json'), {root});
  if (manifest.commit !== commit(root)) throw new Error('ATTESTATION_COMMIT: source manifest differs from checkout');
  await verifyManifest(directory, manifest);
  const names = [...manifest.files.map(file => file.path), 'SOURCE-MANIFEST.json', 'SHA256SUMS', 'SBOM.cdx.json'];
  if (new Set(names).size !== names.length) throw new Error('ATTESTATION_SUBJECT: duplicate release asset');
  const subjects = [];
  for (const name of names.sort()) {
    const bytes = await boundedRead(localPath(directory, name), {root});
    subjects.push({path: 'artifacts/' + name, bytes: bytes.length, sha256: sha256(bytes)});
  }
  return subjects;
}

/** Build strict gh verification arguments; caller-provided repository/ref are data, never shell code. */
export function verificationArgs({file, repositoryName, sourceCommit, sourceRef}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repositoryName || '') || !/^[a-f0-9]{40}$/.test(sourceCommit || '')
      || !/^refs\/tags\/v[\w.+-]+$/.test(sourceRef || '')) throw new Error('ATTESTATION_IDENTITY: invalid release identity');
  return ['attestation', 'verify', file, '--repo', repositoryName,
    '--signer-workflow', repositoryName + '/.github/workflows/release.yml',
    '--source-digest', sourceCommit, '--source-ref', sourceRef,
    '--predicate-type', 'https://slsa.dev/provenance/v1', '--deny-self-hosted-runners', '--format', 'json'];
}

/** Invoke the real GitHub signature verifier once for every release asset. No unsigned fallback exists. */
export async function verifyAttestations({root = repository, repositoryName, sourceRef, signal} = {}) {
  const sourceCommit = commit(root);
  const subjects = await releaseSubjects({root});
  const results = [];
  for (const subject of subjects) {
    signal?.throwIfAborted();
    const args = verificationArgs({file: subject.path, repositoryName, sourceCommit, sourceRef});
    const result = await runProcess('gh', args, {cwd: root, signal, timeoutMs: 120000, maxOutputBytes: 8 * 1024 * 1024});
    if (result.exitCode !== 0 || result.signal) throw new Error('ATTESTATION_VERIFY: failed for ' + subject.path);
    const verified = JSON.parse(result.stdout);
    if (!Array.isArray(verified) || !verified.length) throw new Error('ATTESTATION_VERIFY: empty verification result');
    results.push({subject, verifier: 'gh attestation verify', verified});
  }
  return {schemaVersion: 1, status: 'pass', sourceCommit, sourceRef, results};
}

if (isMain(import.meta.url)) {
  const [mode] = process.argv.slice(2);
  if (mode === 'subjects') console.log((await releaseSubjects()).map(file => file.path).join('\n'));
  else if (mode === 'verify') {
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    process.once('SIGTERM', () => controller.abort());
    await writeJSON('artifacts/results/supply/attestations.json', await verifyAttestations({
      repositoryName: process.env.GITHUB_REPOSITORY, sourceRef: process.env.GITHUB_REF, signal: controller.signal,
    }));
  } else throw new Error('Usage: attestation.js subjects|verify');
}
