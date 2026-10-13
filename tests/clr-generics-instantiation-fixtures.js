import { codedIndex, encodeSignature, encodeTypeSignature } from '@sharpforge/cil';
import { managedFixture } from './managed-fixtures.js';
import { arrayContext } from './clr-types-array-fixtures.js';

export const primitive = name => ({ kind: 'primitive', name });
export const variable = (index = 0, scope = 'type') => ({ kind: 'genericParameter', scope, index });
export const generic = (token, arguments_, kind = 'class') => ({ kind: 'genericInstance', type: { kind, token }, arguments: arguments_ });

export function genericFixture({ name = 'GenericDefinitions', decorate } = {}) {
  const tokens = {};
  const specs = {};
  const image = managedFixture({ name, entry: null, methods: [], decorate({ md }) {
    const type = (name, arity = 0, { flags = 1, parent = null, attributes = 0 } = {}) => {
      const base = flags & 0x20 ? 0 : codedIndex('TypeDefOrRef', md.typeRef('System.Object'));
      const token = md.add(2, [flags, md.string(name), md.string(parent ? '' : 'Fixture'), base, 1, (md.rows[6]?.length ?? 0) + 1]);
      for (let position = 0; position < arity; position++) {
        md.add(42, [position, attributes, codedIndex('TypeOrMethodDef', token), md.string(`T${position}`)]);
      }
      if (parent) md.add(41, [token & 0xffffff, parent & 0xffffff]);
      return token;
    };
    const specification = (name, signature) => {
      const token = md.add(27, [md.blob(signature instanceof Uint8Array ? signature : encodeTypeSignature(signature))]);
      specs[name] = token;
      return token;
    };
    const base = (owner, signature, name) => {
      md.rows[2][(owner & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', specification(name, signature));
    };
    const contract = (owner, signature, name) => {
      md.add(9, [owner & 0xffffff, codedIndex('TypeDefOrRef', specification(name, signature))]);
    };

    tokens.box = type('Box`1', 1);
    tokens.pair = type('Pair`2', 2);
    tokens.other = type('Other`1', 1);
    tokens.cell = type('Cell`1', 1, { flags: 0x109 });
    md.rows[2][(tokens.cell & 0xffffff) - 1][3] = codedIndex('TypeDefOrRef', md.typeRef('System.ValueType'));
    tokens.contract = type('IContract`1', 1, { flags: 0xa1 });
    tokens.variant = type('IVariant`1', 1, { flags: 0xa1, attributes: 1 });
    tokens.left = type('ILeft`1', 1, { flags: 0xa1 });
    tokens.right = type('IRight`1', 1, { flags: 0xa1 });
    tokens.derived = type('Derived`1', 1);
    tokens.reorder = type('Reorder`2', 2);
    tokens.node = type('Node`1', 1);
    tokens.outer = type('Outer`1', 1);
    tokens.inner = type('Inner`1', 2, { parent: tokens.outer });
    tokens.inheritedInner = type('NonGenericInner', 1, { parent: tokens.outer });
    tokens.detachedInner = type('DetachedInner', 0, { parent: tokens.outer });
    tokens.arityName = type('UnmarkedArity', 2);
    tokens.constrained = type('Constrained`1', 1, { attributes: 4 });
    tokens.methodOwner = type('MethodOwner`1', 1);
    const method = md.add(6, [0, 0, 0x16, md.string('M'), md.blob(encodeSignature({ kind: 'method',
      hasThis: false, genericArity: 1, returnType: primitive('void'), parameters: [] })), 1]);
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', method), md.string('M0')]);
    tokens.method = method;

    contract(tokens.left, generic(tokens.contract, [variable()]), 'leftContract');
    contract(tokens.right, generic(tokens.contract, [variable()]), 'rightContract');
    base(tokens.derived, generic(tokens.box, [variable()]), 'derivedBase');
    contract(tokens.derived, generic(tokens.left, [variable()]), 'derivedLeft');
    contract(tokens.derived, generic(tokens.right, [variable()]), 'derivedRight');
    base(tokens.reorder, generic(tokens.box, [generic(tokens.pair, [variable(1), variable()])]), 'reorderedBase');
    base(tokens.node, generic(tokens.box, [generic(tokens.node, [variable()])]), 'nodeBase');
    contract(tokens.node, generic(tokens.contract, [generic(tokens.node, [generic(tokens.node, [variable()])])]), 'nodeContract');
    specification('integer', primitive('int'));
    specification('boxInteger', generic(tokens.box, [primitive('int')]));
    specification('cellInteger', generic(tokens.cell, [primitive('int')], 'valuetype'));
    specification('scopePair', generic(tokens.pair, [variable(), variable(0, 'method')]));
    specification('scopeType', variable());
    specification('scopeMethod', variable(0, 'method'));
    specification('scopeArray', { kind: 'szarray', element: variable() });
    specification('scopeNested', generic(tokens.box, [{ kind: 'szarray', element: generic(tokens.pair, [variable(), primitive('int')]) }]));
    decorate?.({ md, type, specification, base, contract, tokens, specs });
  } });
  return { image, tokens, specs };
}

export async function openGenerics(options = {}, fixtureOptions = {}) {
  const fixture = genericFixture(fixtureOptions);
  const context = arrayContext(options);
  const assembly = await context.loadFromStream(fixture.image);
  const module = assembly.manifestModule;
  const definitions = Object.fromEntries(Object.entries(fixture.tokens)
    .filter(([, token]) => token >>> 24 === 2).map(([name, token]) => [name, module.typeDefinition(token)]));
  return { ...fixture, context, types: context.types, module, assembly, definitions };
}

export function genericConsumer(name, target = 'GenericDefinitions') {
  let specification;
  const image = managedFixture({ name, entry: null, methods: [], decorate({ md }) {
    md.referenceIdentities.set(target.toLowerCase(), { name: target, version: [0, 2, 0, 0],
      culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
    const definition = md.typeRef('Fixture.Box`1', target);
    specification = md.add(27, [md.blob(encodeTypeSignature(generic(definition, [primitive('int')])))]);
  } });
  return { image, specification };
}

export function remoteGenericFixture() {
  return genericFixture({ name: 'RemoteGenerics', decorate({ md, tokens, base, specification }) {
    md.referenceIdentities.set('dependency', { name: 'Dependency', version: [0, 2, 0, 0],
      culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
    const box = md.typeRef('Fixture.Box`1', 'Dependency');
    const pair = md.typeRef('Fixture.Pair`2', 'Dependency');
    base(tokens.box, generic(box, [variable()]), 'remoteBase');
    specification('remotePair', generic(pair, [variable(), variable(0, 'method')]));
    const element = generic(pair, [variable(), variable(0, 'method')]);
    const array = specification('remoteArray', { kind: 'szarray', element });
    tokens.arrayGet = md.member(array, 'Get', encodeSignature({ kind: 'method', hasThis: true,
      genericArity: 0, returnType: element, parameters: [primitive('int')] }));
  } });
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
