import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateEditorReport } from './check-editor-perf.js';
import { validateWorkbenchTrace } from '../tests/workbench-perf-budget.mjs';

/** Reviewed inputs only: the overall a5 qualification failed; these two completed captures passed. */
export const a5BaselineProfile = Object.freeze({
  id: 'a5', runner: 'ubuntu-latest', engine: 'chromium',
  sourceSha: 'c13aa0fd9d27df28b3708bb83d914a04c20a5c7c',
  sourceTree: '29023ed8b962b6d91671bdb0c0359d905ef2659e',
  workflowRunId: '37178840757',
  review: 'Root integration review accepts these pinned captures as strict comparative inputs; no human approval or overall a5 pass is claimed.',
  source: Object.freeze({ path: 'docs/evidence/project16-hosted/a5/source.json', bytes: 473,
    sha256: '96a4d8ab7806700ec9539048a6eb8b2b71483fb79bcb013b3c06086475378237' }),
  editor: Object.freeze({ path: 'docs/evidence/project16-hosted/a5/editor-browser.json', bytes: 38079,
    sha256: 'd514882e71ede3ec24fabec5337a3a89381d0ca0ced192aac0bdac4aacee42b8' }),
  workbench: Object.freeze({ path: 'docs/evidence/project16-hosted/a5/workbench-large-trace.json', bytes: 29341,
    sha256: '4f0c0583e184d63ff58ff1972ed833383d151d3e9aacdb4259900526fe523d83' })
});
const profiles = new Map([[a5BaselineProfile.id, a5BaselineProfile]]);

function selectedProfile(selection) {
  const profile = profiles.get(selection.baselineProfile);
  if (!profile) throw new Error('Unknown reviewed qualification baseline profile');
  if (selection.eventName !== 'create' || selection.runner !== profile.runner || selection.engine !== profile.engine
      || !['all', 'performance'].includes(selection.stage)) {
    throw new Error('The a5 baseline profile requires a create trigger with ubuntu/chromium and all or performance');
  }
  return profile;
}

/** Reserve compare- requests so an unknown or malformed profile cannot silently become capture-only. */
export function baselineProfileRequest(selection) {
  if (!selection.nonce.startsWith('compare-')) return null;
  const match = /^compare-([a-z0-9]+)-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/.exec(selection.nonce);
  if (!match) throw new Error('Malformed comparative qualification nonce');
  selectedProfile({ ...selection, eventName: 'create', baselineProfile: match[1] });
  return match[1];
}

function verifySource(source, editor, profile) {
  if (source.sourceSha !== profile.sourceSha || source.sourceTree !== profile.sourceTree
      || source.workflowRunId !== profile.workflowRunId || source.runnerLabel !== profile.runner || source.runner !== 'Linux'
      || source.engine !== profile.engine || source.stage !== 'all' || source.captureOnly !== true
      || editor.environment.commit !== profile.sourceSha) {
    throw new Error('Reviewed a5 baseline source manifest does not match its pinned capture identity');
  }
}

/** Verify archived bytes and schemas before selection; live host checks stay in performance preflight. */
export async function activateBaselineProfile(selection, { root, read = readFile, inspect = stat } = {}) {
  if (!selection.baselineProfile) return selection;
  const profile = selectedProfile(selection);
  const specifications = new Map([profile.source, profile.editor, profile.workbench]
    .map(specification => [resolve(root, specification.path), specification]));
  const verifiedRead = async path => {
    const specification = specifications.get(path);
    if (!specification) throw new Error('Unreviewed baseline profile path');
    const information = await inspect(path);
    if (!information.isFile() || information.size !== specification.bytes) {
      throw new Error(`Reviewed a5 baseline size changed: ${specification.path}`);
    }
    const bytes = Buffer.from(await read(path));
    if (bytes.length !== specification.bytes || createHash('sha256').update(bytes).digest('hex') !== specification.sha256) {
      throw new Error(`Reviewed a5 baseline SHA-256 changed: ${specification.path}`);
    }
    return bytes.toString('utf8');
  };
  const source = JSON.parse(await verifiedRead(resolve(root, profile.source.path)));
  const [editor, workbench] = await Promise.all([profile.editor, profile.workbench]
    .map(async specification => JSON.parse(await verifiedRead(resolve(root, specification.path)))));
  validateEditorReport(editor);
  validateWorkbenchTrace(workbench);
  verifySource(source, editor, profile);
  return Object.freeze({ ...selection, editorBaseline: profile.editor.path, workbenchBaseline: profile.workbench.path,
    captureOnly: false, baselineProfileVerified: true });
}
