import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TypeKind } from '../packages/clr/src/index.js';
import { arrayContext } from './clr-types-array-fixtures.js';

const directory = new URL('./fixtures/clr-generic-instantiation/', import.meta.url);
const root = new URL('../', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const frameworkNames = new Set(['System.Runtime', 'System.Collections']);
const descriptorSpecifications = Object.freeze({
  'function-open': 'managedFunction', 'function-closed': 'managedFunction',
  'function-cdecl': 'nativeFunction', 'function-nested': 'nestedFunction',
});

export async function readNativeInstantiation() {
  const native = JSON.parse(await readFile(new URL('native-instantiation.json', directory), 'utf8'));
  assert.equal(native.schemaVersion, 2);
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.referencePack, '10.0.5');
  assert.match(native.compilerSha256, /^[0-9a-f]{64}$/);
  assert.ok(native.compilerVersion.length > 0);
  assert.equal(native.sources.length, 8);
  assert.equal(new Set(native.sources.map(source => source.path)).size, native.sources.length);
  for (const source of native.sources) {
    assert.match(source.path, /^packages\/clr\/(?:interop\/GenericInstantiation\/[A-Za-z]+\.cs|tools\/capture-generic-instantiation\.mjs)$/);
    assert.equal(digest(await readFile(new URL(source.path, root))), source.sha256, source.path);
  }
  assert.equal(native.images.length, 6);
  assert.equal(new Set(native.images.map(image => image.id)).size, native.images.length);
  const images = new Map();
  for (const image of native.images) {
    assert.match(image.file, /^[A-Za-z0-9._-]+\.dll$/);
    const bytes = new Uint8Array(await readFile(new URL(image.file, directory)));
    assert.equal(bytes.length, image.bytes, image.id);
    assert.equal(digest(bytes), image.sha256, image.id);
    images.set(image.id, bytes);
  }
  assert.equal(digest(await readFile(new URL('GenericInstantiationOracle.dll', directory))), native.observerSha256);
  assert.equal(digest(await readFile(new URL('GenericInstantiationOracle.runtimeconfig.json', directory))), native.runtimeConfigSha256);
  assert.equal(digest(await readFile(new URL('capture-inputs.json', directory))), native.captureInputSha256);
  const status = JSON.parse(await readFile(new URL('capture-status.json', directory), 'utf8'));
  assert.equal(status.status, 'passed');
  assert.equal(status.cases, 101);
  assert.equal(status.lifetimeCases, 7);
  assert.equal(status.commands.length, 6);
  assert.ok(status.commands.every(command => command.status === 'passed' && command.exitCode === 0));
  const raw = JSON.parse(await readFile(new URL('native-observer.stdout.txt', directory), 'utf8'));
  for (const field of ['cases', 'identities', 'tokens', 'signatures', 'lifetime']) assert.deepEqual(native[field], raw[field], field);
  return { native, images };
}

/** A fixture host policy. Core type names are deliberate intrinsics, not loaded CoreLib metadata. */
export class NativeInstantiationReplay {
  #native;
  #images;
  #contexts = new Map();
  #contextIds = new WeakMap();
  #modules = new Map();
  #imageNames;
  values = new Map();
  unloadEvents = new Map();

  constructor(native, images) {
    this.#native = native;
    this.#images = images;
    this.#imageNames = new Map(native.images.map(image => [image.assemblyName, image.id]));
  }

  context(id = 'default') {
    if (this.#contexts.has(id)) return this.#contexts.get(id);
    let context;
    context = arrayContext({ name: id, isCollectible: id !== 'default',
      load: ({ assemblyName }) => this.#images.get(this.#imageNames.get(assemblyName.name)) ?? null,
      typeOptions: { resolveExternalType: ({ assemblyName, namespace, name }) => {
        if (!frameworkNames.has(assemblyName.name)) return null;
        assert.deepEqual(assemblyName.version, [10, 0, 0, 0], 'Pinned framework version');
        assert.equal(assemblyName.publicKeyToken, 'b03f5f7f11d50a3a', 'Pinned framework token');
        assert.equal(assemblyName.culture, '', 'Pinned framework culture');
        return context.types.intrinsic(`${namespace}.${name}`);
      } } });
    context.types.defineIntrinsic('System.Collections.Generic.List`1', {
      genericArity: 1, baseType: context.types.intrinsic('System.Object'),
    });
    this.#contexts.set(id, context);
    this.#contextIds.set(context, id);
    this.unloadEvents.set(id, 0);
    context.onUnloading(() => this.unloadEvents.set(id, this.unloadEvents.get(id) + 1));
    return context;
  }

  module(image, context = 'default') {
    const key = `${context}:${image}`;
    if (!this.#modules.has(key)) {
      assert.ok(this.#images.has(image), `Unknown native image ${image}`);
      const module = this.context(context).loadFromStream(this.#images.get(image)).then(assembly => {
        assert.equal(this.#imageNames.get(assembly.identity.name), image);
        return assembly.manifestModule;
      });
      this.#modules.set(key, module);
    }
    return this.#modules.get(key);
  }

  async arguments(shapes) {
    if (shapes === null) return null;
    return Promise.all(shapes.map(shape => shape === null ? null : this.materialize(shape)));
  }

  async scope(request) {
    const scope = {};
    if (request.typeArguments != null) scope.typeArguments = await this.arguments(request.typeArguments);
    if (request.methodArguments != null) scope.methodArguments = await this.arguments(request.methodArguments);
    return scope;
  }

  async materialize(shape) {
    const types = this.context().types;
    if (shape.kind === 'intrinsic') return types.intrinsic(shape.name);
    if (shape.kind === 'definition') return (await this.module(shape.image, shape.context)).typeDefinition(shape.token);
    if (shape.kind === 'parameter') {
      const module = await this.module(shape.image, shape.context);
      const parameters = shape.scope === 'method'
        ? module.methodGenericParameters(shape.ownerToken) : module.genericParameters(shape.ownerToken);
      assert.ok(parameters[shape.index], 'Native parameter owner and position must exist');
      return parameters[shape.index];
    }
    if (shape.kind === 'generic') return types.instantiate(await this.materialize(shape.definition), await this.arguments(shape.arguments));
    if (shape.kind === 'functionPointer') {
      assert.equal(shape.unmanaged, false, 'Constructor inputs in this corpus use managed function pointers');
      return types.functionPointer({ returnType: await this.materialize(shape.returnType),
        parameters: await this.arguments(shape.parameters), callingConvention: 0 });
    }
    const element = await this.materialize(shape.element);
    if (shape.kind === 'szarray') return types.szArray(element);
    if (shape.kind === 'array') return types.array(element, shape.rank);
    if (shape.kind === 'pointer') return types.pointer(element);
    if (shape.kind === 'byref') return types.byRef(element);
    throw new Error(`Unsupported native input shape ${shape.kind}`);
  }

  async run(testCase) {
    const request = testCase.request;
    const types = this.context().types;
    let value;
    if (request.op === 'instantiate') value = await types.instantiate(await this.materialize(request.definition), await this.arguments(request.arguments));
    else if (request.op === 'resolve') value = await types.load(await this.module(request.image, request.context), request.token, await this.scope(request));
    else if (request.op === 'element') value = await this.materialize({ ...request, kind: request.kind });
    else if (request.op === 'baseArgument') {
      const source = request.source ? await this.materialize(request.source) : this.values.get(request.of);
      value = source.baseType.genericArguments[request.index];
    } else if (request.op === 'interfaceArgument') {
      const definition = await this.materialize(request.definition);
      const source = request.source ? await this.materialize(request.source) : this.values.get(request.of);
      value = source.interfaces.find(contract => contract.genericDefinition === definition)?.genericArguments[request.index];
    } else if (request.op === 'retained') {
      for (const id of ['a', 'b']) this.context(id).unload();
      value = this.values.get(request.of);
    } else if (request.op === 'methodParameterDescriptor') {
      const specification = descriptorSpecifications[testCase.id];
      assert.ok(specification, `No matching independent TypeSpec for ${testCase.id}`);
      const image = this.#native.images.find(item => item.id === 'consumerA');
      value = await types.load(await this.module('consumerA'), image.specifications[specification], await this.scope(request));
    } else throw new Error(`Unsupported native request ${request.op}`);
    assert.ok(value, `No result for ${testCase.id}`);
    this.values.set(testCase.id, value);
    return value;
  }

  shape(type) {
    if (type === null) return null;
    if (type.kind === TypeKind.FunctionPointer) return { kind: 'functionPointer', returnType: this.shape(type.signature.returnType),
      parameters: type.signature.parameters.map(parameter => this.shape(parameter)) };
    if (type.elementType) return { kind: type.kind, element: this.shape(type.elementType),
      ...([TypeKind.SZArray, TypeKind.Array].includes(type.kind) ? { rank: type.rank } : {}) };
    if (type.kind === TypeKind.Instantiation) return { kind: 'generic', definition: this.shape(type.genericDefinition),
      arguments: type.genericArguments.map(argument => this.shape(argument)) };
    const module = type.module;
    if (type.kind === TypeKind.GenericParameter) {
      assert.ok(module, 'Native corpus does not supply synthetic intrinsic parameters');
      return { kind: 'parameter', image: this.#imageNames.get(module.assembly.identity.name),
        context: this.#contextIds.get(type.loadContext), ownerToken: type.genericParameterOwner.metadataToken,
        scope: type.declaringMethod ? 'method' : 'type', index: type.genericParameterPosition };
    }
    if (module === null) return { kind: 'intrinsic', name: type.fullName };
    return { kind: 'definition', image: this.#imageNames.get(module.assembly.identity.name),
      context: this.#contextIds.get(type.loadContext), token: type.metadataToken };
  }

  async assertNoBodies() {
    for (const context of this.#contexts.values()) {
      for (const assembly of context.assemblies) assert.equal(assembly.manifestModule.methodBodyReadCount, 0);
    }
  }
}

/** Reflection names and function-pointer convention names are provenance, outside the canonical shape contract. */
export function canonicalNativeShape(shape) {
  if (shape === null || shape === undefined) return null;
  if (shape.kind === 'functionPointer') return { kind: shape.kind, returnType: canonicalNativeShape(shape.returnType),
    parameters: shape.parameters.map(canonicalNativeShape) };
  if (shape.element) return { kind: shape.kind, element: canonicalNativeShape(shape.element),
    ...(['szarray', 'array'].includes(shape.kind) ? { rank: shape.rank ?? 1 } : {}) };
  if (shape.kind === 'generic') return { kind: shape.kind, definition: canonicalNativeShape(shape.definition),
    arguments: shape.arguments.map(canonicalNativeShape) };
  return shape;
}
