import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AssemblyInspector, readPE, metadataSchemas, metadataIndexWidth, decodeCoded, codedIndex } from '@sharpforge/cil';
import { compile, compileToAssembly, createReferenceSet } from '@sharpforge/compiler';
import { locateReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';
import { importAssembly } from '../packages/compiler/src/metadata-import/pe-symbols.js';
import { Table, ridOf, tokenOf } from '../packages/compiler/src/metadata-import/pe-metadata.js';
import { RefKind } from '../packages/compiler/src/symbols/types.js';

// SF-A02-T83: this is the checked-in Roslyn assembly, not a hand-authored approximation of marker metadata.
const directory = fileURLToPath(new URL('./fixtures/imported-extension-blocks/', import.meta.url));
const fixturePath = join(directory, 'ExtensionLibrary.dll');
const fixture = () => new Uint8Array(readFileSync(fixturePath));
const core = importAssembly(new Uint8Array(readFileSync(new URL('./fixtures/metadata/MiniStandard.dll', import.meta.url))));

function load(bytes = fixture()) {
  const assembly = importAssembly(bytes);
  // Metadata shape tests only need these core signatures; they do not execute or claim this is a real pack binding.
  assembly.setReferencedAssemblies(assembly.referencedAssemblyIdentities.map(() => core));
  assembly.corLibrary = core;
  return { assembly, extensions: assembly.getTypeByMetadataName('ExtensionImport.Extensions') };
}

const entry = (type, name) => type.extensionMembers.find(member => member.name === name)?.symbol;
const groupOf = (type, name) => type.getTypeMembers().find(group => group.getMembers(name).length);

/** Change an actual metadata column in a private copy of the PE fixture, using the reader's physical widths. */
function changedFixture(change) {
  const bytes = fixture();
  const image = readPE(bytes);
  const metadata = image.metadata;
  const column = (token, index, value) => {
    const table = token >>> 24;
    const widths = metadataSchemas[table].map(kind => metadataIndexWidth(kind, metadata.counts, metadata.heapFlags));
    const offset = image.metadataOffset + metadata.tableOffset + metadata.rowOffsets[table][ridOf(token) - 1] +
      widths.slice(0, index).reduce((sum, width) => sum + width, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (widths[index] === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  };
  change({ ...load(bytes), metadata, column });
  return load(bytes);
}

test('A02-T83 fixture source and binary match the recorded Roslyn provenance', () => {
  const provenance = JSON.parse(readFileSync(join(directory, 'provenance.json'), 'utf8'));
  const digest = file => createHash('sha256').update(readFileSync(join(directory, file))).digest('hex');
  assert.equal(digest(provenance.source.file), provenance.source.sha256);
  for (const source of provenance.additionalSources) assert.equal(digest(source.file), source.sha256);
  assert.equal(digest(provenance.assembly.file), provenance.assembly.sha256);
  assert.match(provenance.compilerVersion, /^5\./);
  assert.ok(provenance.options.includes('-langversion:14.0'));
});

test('A02-T83 imported properties, static members and operators keep their implementation MethodDef identity', () => {
  const { extensions } = load();
  assert.equal(typeof Object.getOwnPropertyDescriptor(extensions, 'extensionMembers').get, 'function');
  const declarations = extensions.extensionMembers;
  assert.equal(extensions.extensionMembers, declarations, 'the lazy result is cached');
  const twice = entry(extensions, 'Twice');
  assert.ok(twice?.isExtensionProperty);
  assert.equal(twice.getMethod, extensions.getMembers('get_Twice')[0]);
  assert.equal(twice.getMethod.containingType, extensions);
  assert.equal(twice.getMethod.associatedSymbol, null, 'the CLR implementation remains an ordinary static method');
  assert.equal(twice.getMethod.metadataToken >>> 24, Table.MethodDef);
  assert.equal(extensions.getMembers('Twice').length, 0, 'the extension property is not a CLR property on Extensions');
  assert.equal(entry(extensions, 'New'), extensions.getMembers('New')[0]);
  assert.equal(declarations.filter(member => member.name === 'New').length, 2, 'same-arity overloads match by signature');
  assert.equal(entry(extensions, 'Zero').getMethod, extensions.getMembers('get_Zero')[0]);
  assert.equal(entry(extensions, 'op_Addition'), extensions.getMembers('op_Addition')[0]);
  assert.equal(declarations.find(member => member.name === 'op_Addition').kind, 'operator');
  assert.equal(entry(extensions, 'Add').isExtensionMethod, true, 'ordinary extension-method lookup still works');
  assert.equal(entry(extensions, 'Writable').setMethod, extensions.getMembers('set_Writable')[0]);
});

test('A02-T83 generic blocks remap the receiver, implementation parameters and full marker constraints', () => {
  const { extensions } = load();
  const item = entry(extensions, 'Item');
  assert.ok(item);
  const getter = item.getMethod;
  assert.equal(getter.arity, 1);
  assert.equal(getter.returnType, getter.typeParameters[0]);
  assert.equal(getter.extensionReceiverType.typeArguments[0].type, getter.typeParameters[0]);
  assert.equal(item.setMethod.parameters[1].type, item.setMethod.typeParameters[0]);
  const create = entry(extensions, 'Create');
  assert.equal(create.extensionReceiverType.typeArguments[0].type, create.typeParameters[0]);
  const map = entry(extensions, 'Map');
  assert.equal(map.arity, 2);
  assert.equal(map.parameters[0].type.typeArguments[0].type, map.typeParameters[0]);
  assert.equal(map.returnType, map.typeParameters[1]);
  const constrained = entry(extensions, 'SameType');
  assert.equal(constrained.typeParameters[1].constraintTypes[0].type, constrained.typeParameters[0]);
  const constructed = getter.construct(core.getSpecialType('System_Int32'));
  assert.equal(constructed.originalDefinition, getter);
  assert.equal(constructed.returnType.specialType, 'System_Int32');
  assert.equal(entry(extensions, 'ReferenceValue').getMethod.typeParameters[0].hasReferenceTypeConstraint, true);
  assert.equal(entry(extensions, 'StructValue').getMethod.typeParameters[0].hasValueTypeConstraint, true);
  assert.equal(entry(extensions, 'IsUnmanaged').getMethod.typeParameters[0].hasUnmanagedTypeConstraint, true);
});

test('A02-T83 a ref receiver keeps its MethodDef parameter and ref kind', () => {
  const { extensions } = load();
  const current = entry(extensions, 'Current');
  assert.ok(current);
  assert.equal(current.getMethod.parameters[0].refKind, RefKind.Ref);
  assert.equal(current.setMethod.parameters[0].refKind, RefKind.Ref);
  assert.equal(current.getMethod.extensionReceiver.refKind, RefKind.Ref);
  assert.equal(current.getMethod, extensions.getMembers('get_Current')[0]);
});

test('A02-T83 ordinary metadata types stay lazy during extension lookup', () => {
  const { assembly } = load();
  const box = assembly.getTypeByMetadataName('ExtensionImport.Box');
  assert.equal(typeof box._members, 'function');
  assert.equal(box.extensionMembers, undefined);
  assert.equal(typeof box._members, 'function');
});

test('A02-T83 grouping and marker special-name flags are required', () => {
  for (const marker of [false, true]) {
    const { extensions } = changedFixture(({ extensions, metadata, column }) => {
      const group = groupOf(extensions, 'Twice');
      const type = marker ? group.getTypeMembers()[0] : group;
      column(type.metadataToken, 0, metadata.row(type.metadataToken)[0] & ~0x400);
    });
    assert.equal(entry(extensions, 'Twice'), undefined);
    assert.ok(extensions.getMembers('get_Twice').length, 'ordinary MethodDefs are still imported');
  }
});

test('A02-T83 a marker must have exactly one receiver parameter and a void return', () => {
  const { extensions } = changedFixture(({ extensions, metadata, column }) => {
    const marker = groupOf(extensions, 'Twice').getTypeMembers()[0];
    const markerMethod = marker.getMembers('<Extension>$')[0];
    const zero = extensions.getMembers('get_Zero')[0];
    column(markerMethod.metadataToken, 4, metadata.row(zero.metadataToken)[4]);
  });
  assert.equal(entry(extensions, 'Twice'), undefined);
});

test('A02-T83 duplicate marker methods reject the block instead of selecting the first match', () => {
  const { extensions } = changedFixture(({ extensions, column }) => {
    const marker = groupOf(extensions, 'Twice').getTypeMembers()[0];
    const following = extensions.getTypeMembers().flatMap(group => group.getTypeMembers())
      .filter(type => type.metadataToken > marker.metadataToken)
      .sort((left, right) => left.metadataToken - right.metadataToken)[0];
    const lastMethod = following.getMembers('<Extension>$')[0];
    // Extend this marker's MethodList through a second marker method; the following type's list then becomes empty.
    column(tokenOf(Table.TypeDef, ridOf(marker.metadataToken) + 1), 5, ridOf(lastMethod.metadataToken) + 1);
  });
  assert.equal(entry(extensions, 'Twice'), undefined);
});

test('A02-T83 marker-method accessibility does not force eager import of private members', () => {
  const { extensions } = changedFixture(({ extensions, metadata, column }) => {
    const marker = groupOf(extensions, 'Twice').getTypeMembers()[0];
    const method = marker.getMembers('<Extension>$')[0];
    column(method.metadataToken, 2, (metadata.row(method.metadataToken)[2] & ~7) | 1);
  });
  assert.ok(entry(extensions, 'Twice'));
});

test('A02-T83 a member attribute must name a marker nested inside the same grouping type', () => {
  const { extensions } = changedFixture(({ extensions, metadata }) => {
    const property = groupOf(extensions, 'Twice').getMembers('Twice')[0];
    const row = metadata.rows[Table.CustomAttribute].find(attribute => decodeCoded('HasCustomAttribute', attribute[0]) === property.metadataToken);
    assert.ok(row);
    const blob = metadata.blob(row[2]);
    assert.equal(blob[0], 1);
    blob[3] = '!'.charCodeAt(0); // The string's first character changes; the custom-attribute blob stays well formed.
  });
  assert.equal(entry(extensions, 'Twice'), undefined);
});

test('A02-T83 the original proposal marker attribute name is also recognized', () => {
  const { extensions } = changedFixture(({ assembly, extensions, column }) => {
    const property = groupOf(extensions, 'Twice').getMembers('Twice')[0];
    const marker = assembly.metadata.customAttributes(property.metadataToken)
      .find(attribute => attribute.fullName === 'System.Runtime.CompilerServices.ExtensionMarkerAttribute');
    const legacy = assembly.getTypeByMetadataName('System.Runtime.CompilerServices.ExtensionMarkerNameAttribute');
    column(marker.constructorToken, 0, codedIndex('MemberRefParent', legacy.metadataToken));
  });
  assert.ok(entry(extensions, 'Twice'));
  assert.ok(entry(extensions, 'Item'));
});

test('A02-T83 matching names and parameter counts cannot redirect a property to the wrong implementation signature', () => {
  const { extensions } = changedFixture(({ extensions, metadata, column }) => {
    const getter = extensions.getMembers('get_Twice')[0];
    const wrongSignature = extensions.getMembers('New')[0];
    column(getter.metadataToken, 4, metadata.row(wrongSignature.metadataToken)[4]);
  });
  assert.equal(entry(extensions, 'Twice'), undefined);
  assert.ok(entry(extensions, 'Writable'));
});

test('A02-T83 mismatched generic constraints cannot select an implementation', () => {
  const { extensions } = changedFixture(({ extensions, metadata, column }) => {
    const method = extensions.getMembers('Create')[0];
    const parameter = method.typeParameters[0];
    column(parameter.metadataToken, 1, metadata.row(parameter.metadataToken)[1] | 4);
  });
  assert.equal(entry(extensions, 'Create'), undefined);
  assert.ok(entry(extensions, 'Item'));
});

test('A02-T83 receiver ref and out kinds are not interchangeable', () => {
  const { extensions } = changedFixture(({ extensions, metadata, column }) => {
    const parameter = extensions.getMembers('get_Current')[0].parameters[0];
    column(parameter.metadataToken, 0, (metadata.row(parameter.metadataToken)[0] & ~1) | 2);
  });
  assert.equal(entry(extensions, 'Current'), undefined);
});

const pack = locateReferencePack();
const references = pack ? createReferenceSet([...readReferenceFiles(pack.files), { bytes: fixture(), display: fixturePath }]) : null;
const needsPack = pack ? false : 'no .NET reference pack is installed';
const source = `using System; using ExtensionImport;
class Program {
  static void Main() {
    var box = Box.New(4); Console.WriteLine(box.Twice);
    box.Writable = 7; Console.WriteLine(box.Add());
    Console.WriteLine((box + new Box(2)).Value);
    var generic = Box<int>.Create(5); generic.Item = 9; Console.WriteLine(generic.Item);
    Console.WriteLine(Box<int>.Identity(6)); Console.WriteLine(new[] { 3, 4 }.First);
    Console.WriteLine(Box<int>.IsUnmanaged); Console.WriteLine(Box<string>.Create("ok").ReferenceValue);
    Console.WriteLine(Box.New("abc").Value);
  }
}`;
const diagnostics = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d => `${d.code}: ${d.message}`);

test('A02-T83 referenced extension members bind and direct CIL calls only the top-level implementation owner', { skip: needsPack }, () => {
  const result = compileToAssembly(source, { name: 'ExtensionConsumer', references });
  assert.deepEqual(diagnostics(result), []);
  const inspector = new AssemblyInspector(result.assembly);
  const method = inspector.types.find(type => type.name === 'Program').methods.find(method => method.name === 'Main');
  const calls = inspector.getMethod(method.token).instructions.filter(instruction => instruction.name === 'call')
    .map(instruction => inspector.resolveToken(instruction.operand));
  for (const name of ['New', 'get_Twice', 'set_Writable', 'Add', 'op_Addition', 'Create', 'set_Item', 'get_Item', 'Identity', 'get_First']) {
    assert.ok(calls.some(target => target.name === name && target.owner === 'ExtensionImport.Extensions'), `${name} targets the implementation`);
  }
  const groupingNames = references.at(-1).assembly.getTypeByMetadataName('ExtensionImport.Extensions')
    .getTypeMembers().map(group => group.metadataFullName);
  assert.ok(calls.every(target => !groupingNames.includes(target.owner)), 'grouping skeleton bodies must never be invoked');
  assert.deepEqual(diagnostics(compileToAssembly(source, { references })), [], 'the same reference set remains reusable');
});

test('A02-T83 .NET executes the direct CIL consumer of Roslyn extension metadata', { skip: needsPack }, context => {
  const root = resolve(pack.directory, '../../../../..');
  const dotnet = join(root, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  if (!existsSync(dotnet)) return context.skip('the installed reference pack has no .NET host');
  const result = compileToAssembly(source, { name: 'ExtensionConsumer', references });
  assert.deepEqual(diagnostics(result), []);
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-extension-import-'));
  try {
    writeFileSync(join(scratch, 'ExtensionConsumer.dll'), result.assembly);
    writeFileSync(join(scratch, 'ExtensionConsumer.runtimeconfig.json'), JSON.stringify({
      runtimeOptions: { tfm: pack.targetFramework, framework: { name: 'Microsoft.NETCore.App', version: pack.version } },
    }));
    copyFileSync(fixturePath, join(scratch, 'ExtensionLibrary.dll'));
    const output = execFileSync(dotnet, [join(scratch, 'ExtensionConsumer.dll')], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(output.replace(/\r\n/g, '\n'), '8\n10\n9\n9\n6\n3\nTrue\nok\n3\n');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('A02-T83 imported extensions preserve generic constraints and missing-member diagnostics', { skip: needsPack }, () => {
  const result = compile('using ExtensionImport; class Program { static void Main() { ' +
    'var box = new Box<string>("s"); int value = box.StructValue; int missing = box.Unknown; } }', { references });
  const codes = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code);
  assert.ok(codes.includes('CS1061'), codes.join(', '));
  assert.ok(!entry(references.at(-1).assembly.getTypeByMetadataName('ExtensionImport.Extensions'), 'Unknown'));
});
