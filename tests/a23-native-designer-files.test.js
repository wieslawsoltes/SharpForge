import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMSBuildHost } from '@sharpforge/msbuild/node';
import { MSBuildClient } from '@sharpforge/msbuild';

function utf16(text, endian, bom) {
  const content = Buffer.from(text, 'utf16le');
  if (endian === 'be') content.swap16();
  return bom ? Buffer.concat([Buffer.from(endian === 'be' ? [254, 255] : [255, 254]), content]) : content;
}

test('A23 native HTTP XAML and manifest saves preserve UTF-16 bytes and reject binary content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-native-designer-'));
  const host = await startMSBuildHost({ root, port: 0 });
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  try {
    for (const extension of ['xaml', 'manifest']) for (const endian of ['le', 'be']) for (const bom of [false, true]) {
      const path = `View-${endian}-${bom}.${extension}`;
      const text = '<Window Title="before">\r\n<!-- café 😀 -->\r\n</Window>';
      const original = utf16(text, endian, bom);
      await writeFile(join(root, path), original);
      const record = await client.read(path);
      assert.equal(record.text, text);
      assert.equal(record.encoding, `utf-16${endian}`);
      assert.equal(record.bom, bom);
      const unchanged = await client.save([{ path, text, expectedHash: record.hash }]);
      assert.equal(unchanged.written[0].hash, record.hash);
      assert.deepEqual(await readFile(join(root, path)), original);
      const edited = text.replace('before', 'after');
      await client.save([{ path, text: edited, expectedHash: record.hash }]);
      assert.deepEqual(await readFile(join(root, path)), utf16(edited, endian, bom));
      assert.equal((await client.read(path)).text, edited);
    }
    await client.save([{ path: 'Native.vcxproj', text: '<Project />', expectedHash: null }]);
    assert.equal((await client.read('Native.vcxproj')).text, '<Project />');
    for (const extension of ['xaml', 'manifest']) {
      const path = `binary.${extension}`, bytes = Uint8Array.of(1, 2, 3, 4);
      await writeFile(join(root, path), bytes);
      await assert.rejects(client.read(path), /Binary files are not editable text/);
      await assert.rejects(client.save([{ path, text: '<Window />',
        expectedHash: createHash('sha256').update(bytes).digest('hex') }]), /Binary files are not editable text/);
      assert.deepEqual(new Uint8Array(await readFile(join(root, path))), bytes);
    }
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});
