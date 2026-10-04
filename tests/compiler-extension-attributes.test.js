import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { parseCompilerInput } from '../packages/compiler/src/parse-input.js';
import { MetadataView, Table, tokenOf, ridOf, findType, findMethod, methodsOf, methodSnapshot, genericSnapshot, attributeSnapshot } from
  './fixtures/exported-extension-blocks/metadata.mjs';
import { locateInteropToolchain, interopScratch } from './fixtures/exported-extension-blocks/dotnet.mjs';

const source = readFileSync(new URL('./fixtures/exported-extension-blocks/AttributedExtensions.cs', import.meta.url), 'utf8');
const toolchain = locateInteropToolchain();
const skip = toolchain ? false : 'Extension attribute interoperability requires an installed .NET 10+ SDK and reference pack';
const relevant = name => name.startsWith('AttributeExport.');
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d => `${d.code}: ${d.message}`);

function analyzed(text) {
  const analysis = new SemanticAnalysis(parseCompilerInput(text, { name: 'AttributedExtensions' }), { name: 'AttributedExtensions', langVersion: '14' });
  const result = analysis.run();
  assert.deepEqual(errors(result), []);
  return analysis;
}

function extensionSnapshot(view) {
  const owner = findType(view, 'AttributeExport.Extensions');
  const implementations = methodsOf(view, owner).map(method => methodSnapshot(view, method, relevant));
  const groups = [];
  for (const groupRid of view.nesting.nested.get(ridOf(owner)) ?? []) {
    const group = tokenOf(Table.TypeDef, groupRid);
    const methods = methodsOf(view, group).map(method => methodSnapshot(view, method, relevant));
    const [start, end] = view.memberMapRange(Table.PropertyMap, Table.Property, groupRid);
    const properties = Array.from({ length: end - start }, (_, index) => {
      const token = tokenOf(Table.Property, start + index);
      return { name: view.string(view.row(Table.Property, start + index)[1]), attributes: attributeSnapshot(view, token, relevant) };
    });
    const markers = (view.nesting.nested.get(groupRid) ?? []).map(markerRid => {
      const marker = tokenOf(Table.TypeDef, markerRid);
      return { parameters: genericSnapshot(view, marker, relevant),
        receiver: methodSnapshot(view, findMethod(view, marker, '<Extension>$'), relevant) };
    });
    groups.push({ methods, properties, markers, typeParameters: genericSnapshot(view, group, relevant) });
  }
  const sorted = values => values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  for (const group of groups) {
    sorted(group.methods);
    sorted(group.properties);
    sorted(group.markers);
  }
  return { implementations: sorted(implementations), groups: sorted(groups) };
}

test('A02-T83 property-only attributes bind to extension property symbols without changing implementation identity', () => {
  const analysis = analyzed(source);
  const owner = analysis.assembly.types.find(type => type.name === 'Extensions');
  for (const name of ['Length', 'Writable', 'Size']) {
    const property = owner.extensionMembers.find(entry => entry.name === name).symbol;
    assert.equal(property.boundAttributes.filter(attribute => attribute.attributeClass.name === 'PropertyOnlyAttribute').length, 1);
    assert.equal(property.getMethod.associatedSymbol, null);
    assert.equal(property.getMethod.methodKind, 'ordinary');
  }
  const staticProperty = owner.extensionMembers.find(entry => entry.name === 'Size').symbol;
  assert.equal(staticProperty.getMethod.extensionReceiver.boundAttributes.length, 1);
  assert.equal(staticProperty.getMethod.parameters.length, 0);
  const setter = owner.getMembers('set_Writable')[0];
  assert.equal(setter.boundAttributes[0].location, 'param');
});

test('A02-T83 extension property AttributeUsage and duplicate diagnostics apply at their source target', () => {
  for (const [text, code] of [
    [source.replace('[PropertyOnly("expression")]', '[Tag("first"), Tag("second")]'), 'CS0579'],
    [source.replace('[Tag("method")]', '[PropertyOnly("invalidMethod")]'), 'CS0592'],
  ]) {
    const analysis = new SemanticAnalysis(parseCompilerInput(text), { langVersion: '14' });
    const result = analysis.run();
    assert.equal(result.diagnostics.filter(diagnostic => diagnostic.code === code).length, 1, errors(result).join('\n'));
  }
});

test('A02-T83 extension attribute targets match a real Roslyn library for both assembly APIs', { skip }, () => {
  const scratch = interopScratch(toolchain);
  try {
    const reference = scratch.compile(source, { name: 'RoslynAttributes', library: null, target: 'library' });
    assert.equal(reference.status, 0, reference.output);
    const oracle = new MetadataView(new Uint8Array(readFileSync(join(scratch.directory, 'RoslynAttributes.dll'))));
    for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
      const result = emit(source, { name: 'AttributedExtensions', outputKind: 'library', langVersion: '14', references: toolchain.references });
      assert.deepEqual(errors(result), []);
      assert.deepEqual(extensionSnapshot(new MetadataView(result.assembly)), extensionSnapshot(oracle));
    }
  } finally {
    scratch.close();
  }
});
