import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AssemblyIdentity, AssemblyIdentityParts, IdentityComparison, compareAssemblyIdentity,
  referenceMatchesDefinition, compareVersions, publicKeyToken, sha1,
} from '@sharpforge/cil';
import { projectAssemblyKey } from '@sharpforge/bytecode';

test('shared identities retain unsigned defaults, escaped names and exact identity components', () => {
  const identity = new AssemblyIdentity({ name: 'Library,[test]', version: '1.2', cultureName: 'neutral' });
  assert.equal(identity.publicKeyToken, '');
  assert.equal(identity.cultureName, '');
  assert.deepEqual(identity.version, [1, 2, 0, 0]);
  assert.equal(identity.getDisplayName(), 'Library\\,[test], Version=1.2.0.0, Culture=neutral, PublicKeyToken=null');
  assert.equal(projectAssemblyKey(identity), identity.getDisplayName());
  assert.ok(AssemblyIdentity.parse(identity.getDisplayName()).equals(identity));
  assert.ok(identity.equals(new AssemblyIdentity({ name: 'library,[test]', version: [1, 2, 0, 0] })));
  assert.ok(!identity.equals(identity.withVersion('1.2.0.1')));
  assert.ok(Object.isFrozen(identity));
  assert.ok(Object.isFrozen(identity.version));
  assert.equal(compareVersions(identity.version, [1, 3, 0, 0]), -1);
});

test('shared identity flags and tokens preserve complete display and parse behavior', () => {
  const identity = new AssemblyIdentity({ name: 'Flags', version: [2, 3, 4, 5], cultureName: 'en-US',
    publicKeyToken: 'B03F5F7F11D50A3A', isRetargetable: true, contentType: 'windowsRuntime' });
  assert.equal(projectAssemblyKey(identity), identity.getDisplayName());
  const parsed = AssemblyIdentity.tryParse(identity.getDisplayName());
  assert.ok(parsed.identity.equals(identity));
  assert.equal(parsed.parts, 63);
  assert.ok(!identity.equals(new AssemblyIdentity({ ...identity, isRetargetable: false })));
  assert.ok(!identity.equals(new AssemblyIdentity({ ...identity, contentType: 'default' })));
  const partial = AssemblyIdentity.tryParse('Flags, Version=2.3');
  assert.equal(partial.parts & AssemblyIdentityParts.Version, 0);
  for (const invalid of ['Flags, Version=65536', 'Flags, Retargetable=Yes', 'Flags, PublicKeyToken=abcd']) {
    assert.equal(AssemblyIdentity.tryParse(invalid), null);
    assert.throws(() => AssemblyIdentity.parse(invalid), RangeError);
  }
});

test('shared binding comparison retains strong and weak version policies', () => {
  const weak = new AssemblyIdentity({ name: 'Library', version: '1.0.0.0' });
  const strong = new AssemblyIdentity({ ...weak, publicKeyToken: '0123456789abcdef' });
  assert.equal(compareAssemblyIdentity(weak, weak.withVersion('2.0.0.0')).result, IdentityComparison.Equivalent);
  assert.equal(compareAssemblyIdentity(strong, strong.withVersion('2.0.0.0')).result, IdentityComparison.NotEquivalent);
  assert.equal(compareAssemblyIdentity(strong, strong.withVersion('2.0.0.0'), { ignoreVersion: true }).result,
    IdentityComparison.EquivalentIgnoringVersion);
  assert.equal(referenceMatchesDefinition('Library', strong), true);
  assert.equal(referenceMatchesDefinition(strong, weak), false);
});

test('shared SHA-1 and public key tokens preserve standard and block-boundary vectors', () => {
  for (const length of [0, 3, 55, 56, 63, 64, 65, 127, 128, 1024]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 255);
    assert.deepEqual(Buffer.from(sha1(bytes)), createHash('sha1').update(bytes).digest());
  }
  const ecma = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(publicKeyToken(ecma), 'b77a5c561934e089');
  assert.equal(publicKeyToken(new Uint8Array()), '');
  assert.equal(new AssemblyIdentity({ name: 'mscorlib', publicKey: ecma }).publicKeyToken, publicKeyToken(ecma));
});
