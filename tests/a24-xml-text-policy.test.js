import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWorkspaceFile, encodeWorkspaceFile, isWorkspaceTextPath } from '@sharpforge/archive';

test('XAML, manifests and publish profiles preserve encoding and binary rejection with exact extension matching', () => {
  const text = '<Page Title="λ">\r\n</Page>\r\n';
  const source = new TextEncoder().encode(text);
  const binary = Uint8Array.of(0, 1, 2, 3);
  for (const path of ['View.XAML', 'app.MANIFEST', 'Package.APPXMANIFEST', 'Profiles/Release.PUBXML']) {
    assert.equal(isWorkspaceTextPath(path), true);
    assert.equal(decodeWorkspaceFile(path, source).text, text);
    for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
      for (const bom of [false, true]) {
        const bytes = encodeWorkspaceFile({ path, text, encoding, bom });
        const restored = decodeWorkspaceFile(path, bytes);
        assert.equal(restored.text, text);
        assert.equal(restored.encoding, encoding);
        assert.equal(restored.bom, bom);
        assert.deepEqual(encodeWorkspaceFile(restored), bytes);
        const edited = decodeWorkspaceFile(path, encodeWorkspaceFile({ ...restored, text: text.replace('λ', 'μ') }));
        assert.equal(edited.text, text.replace('λ', 'μ'));
        assert.equal(edited.encoding, encoding);
        assert.equal(edited.bom, bom);
      }
    }
    const rejected = decodeWorkspaceFile(path, binary);
    assert.equal(rejected.text, undefined);
    assert.deepEqual(rejected.bytes, binary);
    const opaque = decodeWorkspaceFile(path + '.bin', source);
    assert.equal(isWorkspaceTextPath(path + '.bin'), false);
    assert.equal(opaque.text, undefined);
    assert.deepEqual(opaque.bytes, source);
  }
});
