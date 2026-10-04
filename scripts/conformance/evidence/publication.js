import { join } from 'node:path';

/** Reviewable gh argv only: this module never publishes, replaces or deletes a remote object. */
export function publicationPlan(stage, directory) {
  const { manifest, payloads } = stage;
  const notesPath = join(directory, 'RELEASE-NOTES.md');
  const notes = [
    '# Historical evidence archive', '',
    `This archival prerelease retains ${manifest.files.length} generated reports and binary evidence files formerly tracked in docs/.`,
    `The exact archival source snapshot is ${manifest.snapshotCommit}. It is not inferred to be the revision tested by these reports.`, '',
    'All payload bytes, embedded claims, timestamps, environment details and original source references are retained unchanged.',
    'No tests were rerun by archiving. This is not a product version, a new qualification, or a claim that unavailable engines passed.', '',
    'HISTORICAL-EVIDENCE.json records original Git blobs, byte counts and SHA-256 digests.',
    'historical-evidence.zip preserves the original docs/ paths for relative references between reports.',
    'SHA256SUMS covers every report, the provenance manifest and the ZIP.', '',
  ].join('\n');
  return {
    notes,
    plan: {
      schemaVersion: 1, command: 'gh',
      preconditions: [
        'Review all staged payloads, provenance and MIGRATION-PLAN.json before publication.',
        'The snapshot commit must already be reachable in the remote repository.',
        'Confirm the release tag and release do not exist; stop on any pre-existing object or non-404 lookup error.',
        'Confirm the source commit excludes evidence-archive-* releases from product reproducibility qualification.',
      ],
      absentBeforePublication: [
        `repos/${manifest.repository}/git/ref/tags/${manifest.tag}`,
        `repos/${manifest.repository}/releases/tags/${manifest.tag}`,
      ],
      argv: [
        'release', 'create', manifest.tag, '--repo', manifest.repository, '--target', manifest.snapshotCommit,
        '--title', 'Historical validation evidence archive', '--prerelease', '--latest=false', '--notes-file', notesPath,
        ...[...payloads.keys()].sort().map(name => join(directory, name)),
      ],
      afterPublication: 'Run archive-evidence.js --mode verify; migration separately re-downloads all public assets before removal.',
      recovery: 'A failed upload leaves originals intact. Never use --clobber or delete/replace tags, releases or assets; inspect the partial release.',
    },
  };
}
