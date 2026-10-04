import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { MetadataView, Table, parseMethodSignature } from '../packages/compiler/src/metadata-import/pe-metadata.js';

const pack = loadReferencePack();
const source = '#nullable enable\npublic delegate string? Callback(string? value);';
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');

for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
  for (const realReferences of [false, true]) {
    test(`A02-T05.3 ${emit.name} resolves synthesized delegate framework signatures with ${realReferences ? 'PE' : 'registry'} references`,
      { skip: realReferences && !pack ? 'no installed .NET reference pack' : false }, () => {
        const result = emit(source, { outputKind: 'library', ...(realReferences ? { references: pack.references } : {}) });
        assert.deepEqual(errors(result), []);
        assert.ok(result.assembly instanceof Uint8Array);
        const view = new MetadataView(result.assembly);
        const methods = new Map(view.rows(Table.MethodDef).map(row => [view.string(row[3]), parseMethodSignature(view.blob(row[4]))]));
        const name = slot => {
          const type = view.typeTokenName(slot.token);
          return [type.namespace, type.name].filter(Boolean).join('.');
        };
        assert.equal(name(methods.get('BeginInvoke').returnType), 'System.IAsyncResult');
        assert.equal(name(methods.get('BeginInvoke').parameters[1]), 'System.AsyncCallback');
        assert.equal(name(methods.get('EndInvoke').parameters.at(-1)), 'System.IAsyncResult');
        assert.equal(methods.get('Invoke').returnType.code, 14);
        assert.equal(methods.get('EndInvoke').returnType.code, 14);
      });
  }
}
