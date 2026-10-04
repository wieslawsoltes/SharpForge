import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { ReferenceManager } from '../packages/compiler/src/metadata-import/reference-manager.js';
import { applyTypeTransforms, decodeWellKnownAttributes } from '../packages/compiler/src/metadata-import/attributes.js';
import { encodeNullableFlags } from '../packages/compiler/src/nullable/metadata-flags.js';
import { tupleElementNamesOf } from '../packages/compiler/src/binder/tuples.js';
import { SymbolDisplayFormat } from '../packages/compiler/src/symbols/types.js';
import { MetadataView, Table, tokenOf, ridOf, findType, extensionMarker, genericSnapshot, attributeSnapshot } from
  './fixtures/exported-extension-blocks/metadata.mjs';
import { locateInteropToolchain, interopScratch } from './fixtures/exported-extension-blocks/dotnet.mjs';

const toolchain = locateInteropToolchain();
const skip = toolchain ? false : 'Extension constraint interoperability requires an installed .NET 10+ SDK and reference pack';
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');

function nullableContext(view, owner) {
  let token = owner;
  while (token) {
    const data = decodeWellKnownAttributes(view.customAttributes(token));
    if (data.nullableContext != null) return data.nullableContext;
    const parent = view.nesting.enclosing.get(ridOf(token));
    token = parent ? tokenOf(Table.TypeDef, parent) : 0;
  }
  return decodeWellKnownAttributes(view.customAttributes(tokenOf(Table.Module, 1))).nullableContext ?? 0;
}

function parameterShape(view, assembly, owner) {
  const context = nullableContext(view, owner);
  return view.genericParameters(owner).map(parameter => {
    const data = decodeWellKnownAttributes(view.customAttributes(tokenOf(Table.GenericParam, parameter.rid)));
    return {
      flags: parameter.flags,
      definitionNullable: (Array.isArray(data.nullable) ? data.nullable[0] : data.nullable) ?? context,
      constraints: view.genericConstraints(parameter.rid).map(constraint => {
        const attributes = decodeWellKnownAttributes(view.customAttributes(tokenOf(Table.GenericParamConstraint, constraint.rid)));
        // These fixtures constrain T to closed I<string>/I<ValueTuple<...>> types, so the token needs no VAR context.
        const annotated = applyTypeTransforms(assembly.typeFromToken(constraint.token), attributes, { nullableContext: context });
        return {
          type: annotated.type.toDisplayString(SymbolDisplayFormat.Signature),
          nullable: encodeNullableFlags(annotated),
          tupleNames: tupleElementNamesOf(annotated.type),
        };
      }),
    };
  });
}

function constraintSnapshot(bytes) {
  const view = new MetadataView(bytes);
  const assembly = new ReferenceManager([...toolchain.references, { bytes }]).assemblies.at(-1);
  const owner = findType(view, 'Extensions');
  const first = extensionMarker(view, owner, 'A'), second = extensionMarker(view, owner, 'B');
  assert.equal(first.group, second.group, 'CLR-equivalent constraints share a grouping type');
  assert.notEqual(first.marker, second.marker, 'exact receiver constraints retain separate marker declarations');
  const transforms = name => /\.(Nullable|NullableContext|TupleElementNames)Attribute$/.test(name);
  const group = genericSnapshot(view, first.group, transforms);
  assert.deepEqual(attributeSnapshot(view, first.group, transforms), []);
  for (const parameter of view.genericParameters(first.group)) {
    assert.deepEqual(attributeSnapshot(view, tokenOf(Table.GenericParam, parameter.rid), transforms), []);
    for (const constraint of view.genericConstraints(parameter.rid)) {
      assert.deepEqual(attributeSnapshot(view, tokenOf(Table.GenericParamConstraint, constraint.rid), transforms), []);
    }
  }
  const groupSymbol = assembly.typeFromToken(first.group);
  return {
    group,
    returns: ['A', 'B'].map(name => encodeNullableFlags(groupSymbol.getMembers(name)[0].returnTypeWithAnnotations)),
    first: parameterShape(view, assembly, first.marker),
    second: parameterShape(view, assembly, second.marker),
  };
}

function sourceFor(constraints, reverse) {
  const members = constraints.map((constraint, index) =>
    `extension<T>(T value) where T : ${constraint} { public ${index ? 'string B() => ""' : 'string? A() => null'}; }`);
  if (reverse) members.reverse();
  return '#nullable enable\npublic interface I<T> { }\npublic static class Extensions {\n' + members.join('\n') + '\n}';
}

test('A02-T83 normalized grouping constraints match Roslyn and do not depend on declaration order', { skip }, () => {
  const scratch = interopScratch(toolchain);
  try {
    for (const constraints of [
      ['I<string?>', 'I<string>'],
      ['I<(string? First, string Second)>', 'I<(string Third, string? Fourth)>'],
    ]) {
      let previous;
      for (const reverse of [false, true]) {
        const source = sourceFor(constraints, reverse);
        const reference = scratch.compile(source, { name: 'RoslynConstraints', library: null, target: 'library' });
        assert.equal(reference.status, 0, reference.output);
        const oracle = constraintSnapshot(new Uint8Array(readFileSync(join(scratch.directory, 'RoslynConstraints.dll'))));
        if (previous) assert.deepEqual(oracle, previous, 'Roslyn constraint semantics are independent of declaration order');
        previous = oracle;
        for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
          const result = emit(source, { name: 'ExtensionConstraints', outputKind: 'library', langVersion: '14',
            references: toolchain.references });
          assert.deepEqual(errors(result), []);
          assert.deepEqual(constraintSnapshot(result.assembly), oracle, emit.name + ': reverse=' + reverse);
        }
      }
    }
  } finally {
    scratch.close();
  }
});
