import { readFileSync } from 'node:fs';
import { AssemblyLoadSession, TypeKind } from '../src/index.js';

// Reuse the retained native image; this example needs no SDK, compiler or network.
const image = readFileSync(new URL('../../../tests/fixtures/clr-generic-instantiation/Fixture.dll', import.meta.url));
const session = new AssemblyLoadSession();
const frameworkTypes = new Set(['Object', 'ValueType', 'Int32']);
const context = session.createContext({
  name: 'Generic metadata example',
  isCollectible: true,
  typeOptions: { resolveExternalType({ assemblyName, namespace, name }) {
    // Bind only this fixture's explicit framework reference to host registrations.
    if (assemblyName.name !== 'System.Runtime' || assemblyName.version.join('.') !== '10.0.0.0' ||
        assemblyName.publicKeyToken !== 'b03f5f7f11d50a3a' || assemblyName.culture !== '' ||
        namespace !== 'System' || !frameworkTypes.has(name)) return null;
    return context.types.intrinsic(`System.${name}`);
  } },
});

try {
  const types = context.types;
  const object = types.defineIntrinsic('System.Object');
  const valueType = types.defineIntrinsic('System.ValueType', { baseType: object });
  const integer = types.defineIntrinsic('System.Int32', { kind: TypeKind.ValueType, baseType: valueType });
  const assembly = await context.loadFromStream(image);
  const module = assembly.manifestModule;
  const box = await types.find(module, 'Fixture.Box`1');
  const pair = await types.find(module, 'Fixture.Pair`2');
  const other = await types.find(module, 'Fixture.Other`1');

  const closed = await types.instantiate(box, [integer]);
  const repeated = await types.instantiate(box, [integer]);
  const open = await types.instantiate(box, box.genericParameters);
  const parameter = other.genericParameters[0];
  const partial = await types.instantiate(pair, [integer, parameter]);
  if (closed !== repeated || open !== box || closed.containsGenericParameters ||
      !partial.containsGenericParameters || partial.genericArguments[1] !== parameter ||
      parameter.genericParameterOwner !== other || module.methodBodyReadCount !== 0) {
    throw new Error('Generic metadata identity invariant failed');
  }

  console.log(JSON.stringify({
    closed: closed.fullName,
    repeatedIdentity: closed === repeated,
    ownParametersNormalizeToDefinition: open === box,
    partial: partial.fullName,
    partialContainsGenericParameters: partial.containsGenericParameters,
    parameterOwner: parameter.genericParameterOwner.fullName,
    methodBodiesRead: module.methodBodyReadCount,
  }, null, 2));
} finally {
  context.unload();
}
