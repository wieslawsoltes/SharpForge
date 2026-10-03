import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, decodeCoded } from '@sharpforge/cil';

test('A03 interop writers preserve coded tags for imports, marshal, security and events', () => {
  const builder = new MetadataBuilder('Interop');
  const scope = builder.manifest.moduleRef({ Name: 'Native' });
  builder.interop.implMap({ MappingFlags: 0x101, MemberForwarded: 0x06000001, ImportName: 'native_call', ImportScope: scope });
  builder.interop.fieldMarshal({ Parent: 0x04000001, NativeType: new Uint8Array([7]) });
  builder.interop.fieldMarshal({ Parent: 0x08000001, NativeType: new Uint8Array([8]) });
  builder.interop.declSecurity({ Action: 2, Parent: 0x20000001, PermissionSet: new Uint8Array([0x2e, 0]) });
  const event = builder.interop.event({ EventFlags: 0x200, Name: 'Changed', EventType: 0x01000001 });
  builder.interop.eventMap({ Parent: 0x02000001, EventList: event });
  builder.interop.methodSemantics({ Semantics: 8, Method: 0x06000001, Association: event });
  const metadata = readMetadata(builder.finish());
  assert.equal(decodeCoded('MemberForwarded', metadata.rows[28][0][1]), 0x06000001);
  assert.equal(metadata.rows[28][0][3], 1);
  assert.deepEqual(metadata.rows[13].map(row => decodeCoded('HasFieldMarshal', row[0])), [0x04000001, 0x08000001]);
  assert.equal(decodeCoded('HasDeclSecurity', metadata.rows[14][0][1]), 0x20000001);
  assert.deepEqual(metadata.rows[18], [[1, 1]]);
  assert.equal(decodeCoded('HasSemantics', metadata.rows[24][0][2]), event);
  assert.throws(() => builder.interop.fieldMarshal({ Parent: event, NativeType: 0 }), /cannot be encoded/);
});
