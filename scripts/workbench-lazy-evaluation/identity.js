import {join} from 'node:path';
import {hashFile, sha256} from '../conformance/build-identity.js';
import {files} from '../conformance/repro/common.js';
import {prepareIdentity} from '../workbench-overhead/identity.js';

/** Extend the existing completed-build provenance with every module specific to this measurement driver. */
export async function evaluationIdentity(root) {
  const identity = await prepareIdentity(root);
  const paths = ['scripts/bench-workbench-lazy-evaluation.js', 'scripts/conformance/security/html-policy.js',
    ...(await files(join(root, 'scripts/workbench-lazy-evaluation'))).map(path => 'scripts/workbench-lazy-evaluation/' + path)];
  const rows = [...identity.report.harness.files];
  for (const path of paths) rows.push({path, ...await hashFile(join(root, path))});
  rows.sort((left, right) => left.path.localeCompare(right.path));
  identity.report.harness = {sha256: sha256(JSON.stringify(rows)), files: rows};
  return identity;
}
