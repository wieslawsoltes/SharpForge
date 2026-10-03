import test from 'node:test';
import assert from 'node:assert/strict';
import { writeWin32Resources } from '@sharpforge/cil';

test('A03 oversized manifest text is rejected before UTF-8 encoding', () => {
  const manifest = 'x'.repeat(16 * 1024 * 1024 + 1);
  assert.throws(() => writeWin32Resources({ manifest }, { sectionRva: 0x2000 }), /manifest exceeds size limit before UTF-8 encoding/);
});

test('A03 small Unicode manifest text remains supported under the shared resource bound', () => {
  const bytes = writeWin32Resources({ manifest: '<assembly>空😀</assembly>' }, { sectionRva: 0x2000 });
  assert(bytes.length > 0);
});
