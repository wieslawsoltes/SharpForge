import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMetadata, decodeCoded, token } from '@sharpforge/cil';
import { metadataFixture } from './fixtures/a03-metadata/fixture.js';

function structuralDump(metadata) {
  const rows = table => metadata.rows[table] ?? [];
  return {
    counts: metadata.counts,
    types: rows(2).map((row, index) => {
      const layout = rows(15).find(item => item[2] === index + 1);
      const enclosing = rows(41).find(item => item[0] === index + 1);
      return { token: token(2, index + 1), name: metadata.string(row[1]), namespace: metadata.string(row[2]), attributes: row[0],
        enclosing: enclosing ? token(2, enclosing[1]) : 0, packing: layout?.[0] ?? 0, size: layout?.[1] ?? 0,
        interfaces: rows(9).map((item, n) => ({ item, n })).filter(entry => entry.item[0] === index + 1)
          .map(({ item, n }) => ({ token: token(9, n + 1), type: decodeCoded('TypeDefOrRef', item[1]) })),
        methods: rows(25).filter(item => item[0] === index + 1)
          .map(item => ({ body: decodeCoded('MethodDefOrRef', item[1]), declaration: decodeCoded('MethodDefOrRef', item[2]) })) };
    }),
    fields: rows(4).map((row, index) => {
      const constant = rows(11).find(item => decodeCoded('HasConstant', item[1]) === token(4, index + 1));
      return { token: token(4, index + 1), name: metadata.string(row[1]), attributes: row[0],
        offset: rows(16).find(item => item[1] === index + 1)?.[0] ?? -1,
        rva: rows(29).find(item => item[1] === index + 1)?.[0] ?? 0,
        constant: constant ? { type: constant[0], value: hex(metadata.blob(constant[2])) } : null };
    }),
    imports: rows(6).map((row, index) => {
      const mapping = rows(28).find(item => decodeCoded('MemberForwarded', item[1]) === token(6, index + 1));
      return { token: token(6, index + 1), name: metadata.string(row[3]), importName: metadata.string(mapping?.[2] ?? 0),
        importModule: mapping ? token(26, mapping[3]) : 0, importFlags: mapping?.[0] ?? 0 };
    }),
    resources: rows(40).map(row => ({ name: metadata.string(row[2]), offset: row[0], attributes: row[1],
      implementation: decodeCoded('Implementation', row[3]) })),
    exported: rows(39).map(row => ({ name: metadata.string(row[2]), namespace: metadata.string(row[3]), attributes: row[0],
      implementation: decodeCoded('Implementation', row[4]) })),
    files: rows(38).map(row => ({ name: metadata.string(row[1]), containsMetadata: !(row[0] & 1), hash: hex(metadata.blob(row[2])) })),
    events: rows(20).map(row => ({ name: metadata.string(row[1]), type: decodeCoded('TypeDefOrRef', row[2]), attributes: row[0] })),
    security: rows(14).map(row => ({ action: row[0], parent: decodeCoded('HasDeclSecurity', row[1]), value: hex(metadata.blob(row[2])) })),
    parameters: rows(8).map((row, index) => ({ name: metadata.string(row[2]), sequence: row[1],
      marshal: hex(metadata.blob(rows(13).find(item => decodeCoded('HasFieldMarshal', item[0]) === token(8, index + 1))?.[1] ?? 0)) })),
  };
}

function hex(bytes) { return Buffer.from(bytes).toString('hex').toUpperCase(); }

test('A03 emitted table rows match independent System.Reflection.Metadata observations', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/a03-metadata/srm.json', import.meta.url), 'utf8'));
  assert.deepEqual(structuralDump(readMetadata(metadataFixture().builder.finish())), expected);
});
