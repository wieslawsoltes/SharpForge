import { resolve } from 'node:path';
import { releaseSubjects, verifyAttestations, verificationArgs } from '../supply/attestation.js';
import { boundedRead, repository, sha256 } from '../supply/files.js';
import { runProcess } from '../oracle/process.js';

/** Bundle is a proof attachment, not a recursively signed subject of its own attestation. */
export async function releaseAssets({ root = repository } = {}) {
  const subjects = await releaseSubjects({ root });
  const path = 'artifacts/provenance.sigstore.json';
  const bytes = await boundedRead(resolve(root, path), { root });
  const bundle = JSON.parse(bytes);
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('Malformed attestation proof bundle');
  return [...subjects, { path, bytes: bytes.length, sha256: sha256(bytes) }];
}

/** Verify hosted provenance and its attached Sigstore bundle with the real GitHub verifier. */
export async function verifyReleaseProof({ root = repository, repositoryName, sourceRef, signal, execute = runProcess } = {}) {
  const hosted = await verifyAttestations({ root, repositoryName, sourceRef, signal });
  await releaseAssets({ root });
  for (const { subject } of hosted.results) {
    signal?.throwIfAborted();
    const args = verificationArgs({ file: subject.path, repositoryName, sourceCommit: hosted.sourceCommit, sourceRef });
    args.push('--bundle', 'artifacts/provenance.sigstore.json');
    const result = await execute('gh', args, { cwd: root, signal, timeoutMs: 120000, maxOutputBytes: 8 * 1024 * 1024 });
    if (result.exitCode !== 0 || result.signal) throw new Error('Attached attestation verification failed: ' + subject.path);
    const verified = JSON.parse(result.stdout);
    if (!Array.isArray(verified) || !verified.length) throw new Error('Attached attestation verifier returned no result');
  }
  return hosted;
}

export function exactDraftAssets(release, expected, { tag, commit, prerelease }) {
  if (!release?.draft || release.tag_name !== tag || release.target_commitish !== commit
      || release.prerelease !== prerelease || !Array.isArray(release.assets)) throw new Error('Draft release identity differs');
  const actual = new Map();
  for (const asset of release.assets) {
    if (actual.has(asset.name) || asset.state !== 'uploaded') throw new Error('Duplicate or incomplete draft asset');
    actual.set(asset.name, asset);
  }
  if (actual.size !== expected.length) throw new Error('Draft asset inventory differs');
  for (const file of expected) {
    const asset = actual.get(file.path.split('/').at(-1));
    if (!asset || asset.size !== file.bytes || asset.digest !== 'sha256:' + file.sha256) {
      throw new Error('Draft asset digest missing or different: ' + file.path);
    }
  }
  return release;
}
