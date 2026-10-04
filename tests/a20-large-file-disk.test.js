import test from 'node:test';
import assert from 'node:assert/strict';
import {readBrowserFiles, readDirectory, DiskWorkspace} from '@sharpforge/project-system';
import {encodeWorkspaceFile, decodeWorkspaceFile} from '@sharpforge/archive';

// Explicit File System Access test doubles; native permission dialogs remain browser qualification.
function fileHandle(name, text) {
  let bytes = new TextEncoder().encode(text);
  let writes = 0;
  const handle = {name, kind: 'file', get bytes() { return bytes; }, get writes() { return writes; },
    setExternal(value) { bytes = new TextEncoder().encode(value); },
    async getFile() { return new File([bytes], name); }, async queryPermission() { return 'granted'; },
    async createWritable() {
      let next;
      return {async write(value) { next = typeof value === 'string' ? new TextEncoder().encode(value) : value; },
        async close() { bytes = new Uint8Array(next); writes++; }, async abort() {}};
    }};
  return handle;
}

function directory(files) {
  return {name: 'Large source fixture', kind: 'directory', async *entries() { yield* Object.entries(files); }};
}

const largeLimits = {maxFileBytes: 128 * 1024 * 1024, maxAssemblyBytes: 128 * 1024 * 1024, maxTotalBytes: 160 * 1024 * 1024};

test('A20 disk defaults still reject source files or save text exceeding 2000000 bytes', async () => {
  const text = 'x'.repeat(2_000_001);
  const handle = fileHandle('Program.cs', 'old');
  const disk = new DiskWorkspace([{path: 'Program.cs', text: 'old'}], new Map([['Program.cs', handle]]));
  assert.equal(disk.limits.maxFileBytes, 2_000_000);
  await assert.rejects(readBrowserFiles([new File([text], 'Program.cs')]), /Source file limit/);
  await assert.rejects(disk.save([{path: 'Program.cs', text}]), /Invalid save text/);
  assert.equal(handle.writes, 0);
  assert.throws(() => new DiskWorkspace([], undefined, undefined, [], [], {maxFileBytes: Infinity}), RangeError);
});

test('A20 explicit readDirectory limits permit >2MB source save and survive the read/write boundary', async () => {
  const original = 'x'.repeat(2_100_000);
  const changed = original.slice(0, -1) + 'Z';
  const handle = fileHandle('Program.cs', original);
  const disk = await readDirectory(directory({'Program.cs': handle}), largeLimits);
  assert.equal(disk.limits.maxFileBytes, largeLimits.maxFileBytes);
  assert(Object.isFrozen(disk.limits));
  const result = await disk.save([{path: 'Program.cs', text: changed, expectedVersion: disk.getVersion('Program.cs')}]);
  assert.deepEqual(result, {written: ['Program.cs'], atomic: false});
  assert.equal(decodeWorkspaceFile('Program.cs', handle.bytes).text, changed);
  assert.equal(disk.records[0].text, changed);
  assert.equal(disk.getVersion('Program.cs'), 1);
  await assert.rejects(disk.save([{path: 'Program.cs', text: original, expectedVersion: 0}]), /version conflict/);
  handle.setExternal('external');
  await assert.rejects(disk.save([{path: 'Program.cs', text: original, expectedVersion: 1}]), /Disk conflict/);
  assert.equal(handle.writes, 1);
});

test('A20 FileList limits propagate to DiskWorkspace and total encoded bytes preflight every write', async () => {
  const records = await readBrowserFiles([new File(['abc'], 'A.cs'), new File(['def'], 'B.cs')], {
    maxFileBytes: 10, maxAssemblyBytes: 10, maxTotalBytes: 8
  });
  const a = fileHandle('A.cs', 'abc');
  const b = fileHandle('B.cs', 'def');
  const disk = new DiskWorkspace(records, new Map([['A.cs', a], ['B.cs', b]]));
  assert.equal(disk.limits.maxTotalBytes, 8);
  await assert.rejects(disk.save([{path: 'A.cs', text: '12345'}, {path: 'B.cs', text: '6789'}]), /total byte limit/);
  assert.equal(a.writes + b.writes, 0);
  await disk.save([{path: 'A.cs', text: '12345'}, {path: 'B.cs', text: '67'}]);
  assert.equal(a.writes + b.writes, 2);
  await assert.rejects(disk.save([{path: 'A.cs', text: '日本語'}]), /total byte limit/);
  assert.equal(a.writes + b.writes, 2);
});

test('A20 UTF-16 limits count encoded bytes including BOM and retain encoding on save', async () => {
  const original = encodeWorkspaceFile({path: 'A.cs', text: 'old', encoding: 'utf-16le', bom: true});
  const handle = fileHandle('A.cs', 'old');
  handle.getFile = async () => new File([handle.writes ? handle.bytes : original], 'A.cs');
  const disk = new DiskWorkspace([decodeWorkspaceFile('A.cs', original)], new Map([['A.cs', handle]]), 'UTF16', [], [], {
    maxFileBytes: 10, maxAssemblyBytes: 10, maxTotalBytes: 10
  });
  await assert.rejects(disk.save([{path: 'A.cs', text: '12345'}]), /Source file limit/);
  await disk.save([{path: 'A.cs', text: '日本語'}]);
  assert.equal(handle.bytes.length, 8);
  assert.equal(decodeWorkspaceFile('A.cs', handle.bytes).encoding, 'utf-16le');
  assert.equal(decodeWorkspaceFile('A.cs', handle.bytes).text, '日本語');
});

test('A20 serialized saves reject a queued stale version and permission-time conflicts before writing', async () => {
  const handle = fileHandle('A.cs', 'old');
  const disk = new DiskWorkspace([{path: 'A.cs', text: 'old'}], new Map([['A.cs', handle]]));
  const first = disk.save([{path: 'A.cs', text: 'first', expectedVersion: 0}]);
  const stale = disk.save([{path: 'A.cs', text: 'stale', expectedVersion: 0}]);
  await first;
  await assert.rejects(stale, /version conflict/);
  assert.equal(handle.writes, 1);
  handle.queryPermission = async () => { handle.setExternal('external'); return 'granted'; };
  await assert.rejects(disk.save([{path: 'A.cs', text: 'next'}]), /Disk conflict/);
  assert.equal(handle.writes, 1);
});
