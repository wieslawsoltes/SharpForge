import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {licenseGate} from '../scripts/conformance/supply/license-gate.js';

const repository = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, repository));

test('actual A05 capture declarations pass normal supply validation and reject missing, changed or unnotified assets', async context => {
  const root = mkdtempSync(join(tmpdir(), 'a05-capture-origins-'));
  context.after(() => rmSync(root, {recursive: true, force: true}));
  const catalog = JSON.parse(read('planning/qualification/supply/licenses.json'));
  const files = catalog.files.filter(row => row.path.startsWith('planning/qualification/a05-evidence/'));
  assert.equal(files.length, 44);
  assert.equal(files.filter(row => row.officialRelease).length, 36);
  const copy = path => {
    const target = join(root, path);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, read(path));
  };
  copy('THIRD_PARTY_NOTICES.md');
  for (const row of files) {
    assert.equal(row.reviewStatus, 'proposed-maintainer-review');
    copy(row.path);
    copy(row.licenseFile);
  }
  const policy = {...catalog, files};
  const result = await licenseGate({root, policy});
  assert.equal(result.status, 'pass');
  assert.equal(result.files, 44);
  await assert.rejects(licenseGate({root, policy: {...policy, files: files.slice(1)}}), /LICENSE_UNLISTED/);
  const changed = [{...files[0], sha256: '0'.repeat(64)}, ...files.slice(1)];
  await assert.rejects(licenseGate({root, policy: {...policy, files: changed}}), /LICENSE_HASH/);
  writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'No capture notice.\n');
  await assert.rejects(licenseGate({root, policy}), /LICENSE_NOTICE/);
});
