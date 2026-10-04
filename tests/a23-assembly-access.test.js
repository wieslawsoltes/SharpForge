import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyIdentity, grantsInternalsAccess } from '@sharpforge/cil';
import { grantsInternalsAccess as compilerFriendAccess } from '../packages/compiler/src/metadata-import/attributes.js';

test('compiler binding and CIL graph loading share weak and full-public-key friend identity rules', () => {
  assert.equal(compilerFriendAccess, grantsInternalsAccess);
  const friend = new AssemblyIdentity({ name: 'Friend', version: '2.0.0.0' });
  assert.equal(grantsInternalsAccess(['fRiEnD'], friend), true);
  assert.equal(grantsInternalsAccess(['Other'], friend), false);
  const key = '00000000000000000400000000000000';
  const signed = new AssemblyIdentity({ name: 'Friend', publicKey: key });
  assert.equal(grantsInternalsAccess(['Friend, PublicKey=' + key.toUpperCase()], signed), true);
  assert.equal(grantsInternalsAccess(['Friend, PublicKey=' + key], friend), false);
  assert.equal(grantsInternalsAccess(['Friend, PublicKey=' + key], { name: 'Friend', publicKeyToken: signed.publicKeyToken }), false);
  const escaped = new AssemblyIdentity({ name: 'Friend, "Quoted"' });
  assert.equal(grantsInternalsAccess(['Friend\\, \\"Quoted\\"'], escaped), true);
  assert.equal(grantsInternalsAccess(["'Friend, \"Quoted\"'"], escaped), true);
  assert.equal(grantsInternalsAccess(['"Friend, Unclosed'], escaped), false);
});

test('invalid friend identity declarations never fall back to an unsigned grant', () => {
  const friend = new AssemblyIdentity({ name: 'Friend' });
  for (const declaration of ['Friend, PublicKey=garbage', 'Friend, PublicKey=', 'Friend, PublicKey=123',
    'Friend, PublicKeyToken=null', 'Friend, Version=1.0.0.0', 'Friend, Culture=neutral',
    'Friend, PublicKey=aa, PublicKey=aa', 'Friend,', 'Friend\u0000', '', null, 42]) {
    assert.equal(grantsInternalsAccess([declaration], friend), false, String(declaration));
  }
  assert.equal(grantsInternalsAccess(new Array(4097).fill('Friend'), friend), false);
  assert.equal(grantsInternalsAccess(['Friend' + ' '.repeat(16384)], friend), false);
  assert.equal(grantsInternalsAccess(['Friend'], { name: null }), false);
  assert.equal(grantsInternalsAccess(null, friend), false);
});
