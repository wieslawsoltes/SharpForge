import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AssemblyInspector, decodeCoded, decodeConstant } from '@sharpforge/cil';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { ReferenceManager } from '../packages/compiler/src/metadata-import/reference-manager.js';
import { dotnetHost, sdkVersion, openDotnetScratch, runFixtureOnDotnet } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

// SF-A02-T80 / SF-A02-T29: optional arguments must survive an assembly boundary.
// ECMA-335 II.22.9, II.22.33; native reflection comparisons are retained beside the compiler fixtures.
const ParamAttributes = Object.freeze({ Optional: 0x10, HasDefault: 0x1000 });

function inspect(source, options = {}, emit = compileToAssembly) {
  const result = emit(source, { name: 'ParameterDefaults', outputKind: 'library', ...options });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error'), []);
  assert.ok(result.assembly instanceof Uint8Array);
  const inspector = new AssemblyInspector(result.assembly);
  const metadata = inspector.metadata;
  const constants = new Map((metadata.rows[11] ?? []).map(([kind, parent, blob]) => [
    decodeCoded('HasConstant', parent), decodeConstant(kind, metadata.blob(blob)),
  ]));
  function parameters(owner, name) {
    const method = inspector.types.find(type => type.name === owner)?.methods.find(candidate => candidate.name === name);
    assert.ok(method, `Missing method ${owner}::${name}`);
    const row = method.token & 0xffffff;
    const start = metadata.rows[6][row - 1][5];
    const end = metadata.rows[6][row]?.[5] ?? (metadata.rows[8]?.length ?? 0) + 1;
    return (metadata.rows[8] ?? []).slice(start - 1, end - 1).flatMap((parameter, index) => {
      if (parameter[1] === 0) return [];
      const token = 0x08000000 | (start + index);
      const attributes = (metadata.rows[12] ?? []).filter(entry => decodeCoded('HasCustomAttribute', entry[0]) === token)
        .map(entry => inspector.resolveToken(decodeCoded('CustomAttributeType', entry[1])).owner);
      return [{
        name: metadata.string(parameter[2]),
        optional: !!(parameter[0] & ParamAttributes.Optional),
        hasDefault: !!(parameter[0] & ParamAttributes.HasDefault),
        value: constants.get(token),
        attributes,
      }];
    });
  }
  return { inspector, parameters };
}

test('A02-T29 optional primitive, enum and null defaults are emitted for both assembly APIs', () => {
  const source = `public enum Mode : short { Fast = 2 }
    public class Samples {
      public static void Choose(int number = 7, char letter = '\\u0104', Mode mode = Mode.Fast,
        string text = "hello", object value = null, bool enabled = true, long large = 9223372036854775807L) { }
    }`;
  for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
    const result = inspect(source, {}, emit).parameters('Samples', 'Choose');
    assert.deepEqual(result.map(parameter => parameter.value), [7, '\u0104', 2, 'hello', null, true, 9223372036854775807n]);
    assert.ok(result.every(parameter => parameter.optional && parameter.hasDefault));
  }
});

test('A02-T80 synthesized delegate Invoke preserves defaults and params attributes', () => {
  const { inspector, parameters } = inspect(`using System;
    public class Samples { public static void Use() {
      var optional = (int value = 13) => value;
      var repeated = (params int[] values) => values.Length;
      Console.WriteLine(optional() + repeated(1, 2));
    } }`);
  const delegates = inspector.types.filter(type => type.name.startsWith('<>f__AnonymousDelegate'));
  assert.equal(delegates.length, 2);
  const optional = parameters(delegates[0].name, 'Invoke')[0];
  assert.equal(optional.value, 13);
  assert.ok(optional.optional && optional.hasDefault);
  const repeated = parameters(delegates[1].name, 'Invoke')[0];
  assert.ok(repeated.attributes.includes('System.ParamArrayAttribute'));
  assert.equal(repeated.hasDefault, false);
});

test('A02-T29 a mandatory parameter is not converted to an optional null default', () => {
  const result = inspect('public class Samples { public static void Required(object value) { } }')
    .parameters('Samples', 'Required')[0];
  assert.equal(result.optional, false);
  assert.equal(result.hasDefault, false);
  assert.equal(result.value, undefined);
});

test('A02-T29 nullable and default value-type defaults retain their constant metadata', () => {
  const result = inspect(`public struct Marker { }
    public class Samples { public static void Pick(int? count = 5, Marker marker = default, int? absent = null) { } }`)
    .parameters('Samples', 'Pick');
  assert.deepEqual(result.map(parameter => parameter.value), [5, null, null]);
  assert.ok(result.every(parameter => parameter.optional && parameter.hasDefault));
});

const pack = loadReferencePack();
test('A02-T29 decimal defaults use DecimalConstant rather than an invalid Constant row', {
  skip: pack ? false : 'no .NET reference pack installed',
}, () => {
  const result = inspect('public class Samples { public static void Price(decimal value = -1.25m) { } }',
    { references: pack.references }).parameters('Samples', 'Price')[0];
  assert.equal(result.optional, true);
  assert.equal(result.hasDefault, false);
  assert.ok(result.attributes.includes('System.Runtime.CompilerServices.DecimalConstantAttribute'));
});

test('A02-T81 non-array params metadata uses ParamCollectionAttribute', {
  skip: pack ? false : 'no .NET reference pack installed',
}, () => {
  const result = inspect(`using System;
    public class Samples { public static int Count(params ReadOnlySpan<int> values) => values.Length; }`,
    { references: pack.references }).parameters('Samples', 'Count')[0];
  assert.ok(result.attributes.includes('System.Runtime.CompilerServices.ParamCollectionAttribute'));
  assert.ok(!result.attributes.includes('System.ParamArrayAttribute'));
});

test('A02-T29 emitted defaults survive metadata import and omitted-argument code generation', {
  skip: pack ? false : 'no .NET reference pack installed',
}, () => {
  const library = compileToAssembly(`public class Defaults {
    public static void Values(int number = 7, char letter = '\\u0104', decimal price = -1.25m, int? count = 5) { }
  }`, { references: pack.references, name: 'Defaults', outputKind: 'library' });
  assert.deepEqual(library.diagnostics.filter(entry => entry.severity === 'error'), []);
  const references = [...pack.references, { bytes: library.assembly }];
  const manager = new ReferenceManager(references);
  const method = manager.assemblies.find(assembly => assembly.name === 'Defaults')
    .getTypeByMetadataName('Defaults').getMembers('Values')[0];
  const parameters = method.parameters;
  assert.ok(parameters.every(parameter => parameter.isOptional && parameter.hasExplicitDefaultValue));
  assert.equal(parameters[0].explicitDefaultValue, 7);
  assert.equal(parameters[1].explicitDefaultValue, '\u0104');
  assert.equal(parameters[2].explicitDefaultValue.toString(), '-1.25');
  assert.equal(parameters[3].explicitDefaultValue, 5);
  const consumer = compileToAssembly('class Program { static void Main() { Defaults.Values(); } }', { references });
  assert.deepEqual(consumer.diagnostics.filter(entry => entry.severity === 'error'), []);
  const inspector = new AssemblyInspector(consumer.assembly);
  const main = inspector.types.find(type => type.name === 'Program').methods.find(member => member.name === 'Main');
  const instructions = inspector.getMethod(main.token).instructions;
  assert.ok(instructions.some(instruction => instruction.name === 'ldc.i4.7'));
  assert.ok(instructions.some(instruction => instruction.name === 'ldc.i4' && instruction.operand === 0x104));
  const constructed = instructions.filter(instruction => instruction.name === 'newobj')
    .map(instruction => inspector.resolveToken(instruction.operand).owner);
  assert.ok(constructed.includes('System.Decimal'));
  assert.ok(constructed.some(owner => owner.startsWith('System.Nullable`1')));
});

test('A02-T29 a separately emitted consumer passes imported defaults on real .NET', {
  skip: pack ? false : 'no .NET reference pack installed',
}, context => {
  const dotnet = dotnetHost(), sdk = sdkVersion(dotnet);
  if (!sdk) return context.skip('no .NET SDK host installed');
  const source = `using System;
    public static class ImportedDefaults {
      public static void Values(int number = 7, char letter = '\\u0104', decimal price = -1.25m, int? count = 5) {
        Console.WriteLine(number); Console.WriteLine(letter); Console.WriteLine(price); Console.WriteLine(count.GetValueOrDefault());
      }
    }`;
  const library = compileToAssembly(source, { name: 'ImportedDefaults', outputKind: 'library', references: pack.references });
  assert.deepEqual(library.diagnostics.filter(entry => entry.severity === 'error'), []);
  const scratch = openDotnetScratch({ dotnet, sdk, pack });
  try {
    const runtime = scratch.context('references');
    runtime.options.references = [...pack.references, { bytes: library.assembly }];
    writeFileSync(join(dirname(runtime.assemblyPath), 'ImportedDefaults.dll'), library.assembly);
    const actual = runFixtureOnDotnet({ source: 'class Program { static void Main() { ImportedDefaults.Values(); } }' },
      { output: '7\nĄ\n-1.25\n5\n' }, runtime);
    assert.equal(actual.ok, true, actual.detail);
  } finally {
    scratch.close();
  }
});
