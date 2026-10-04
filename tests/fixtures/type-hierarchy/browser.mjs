import { AssemblyInspector, AssemblySymbolIndex, AssemblyTypeHierarchy, CilError, sha1 } from '@sharpforge/cil';
import { sha1 as symbolSha1 } from '@sharpforge/symbols';
import { hierarchyFixture, inspector } from './input.mjs';
const assert = (value, message) => { if (!value) throw Error(message); };
const walk = node => [node, ...node.children.flatMap(walk)];
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
function rejects(action, pattern) {
  try { action(); } catch (error) {
    assert(error instanceof CilError && pattern.test(error.message), 'Unexpected error: ' + error.message);
    return;
  }
  throw Error('Missing rejection: ' + pattern);
}
export async function run() {
  const report = { passed: false, checks: [] };
  try {
    assert(sha1 === symbolSha1, 'Shared SHA-1 API identity');
    for (const size of [0, 3, 55, 56, 64, 65, 16384]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => index * 73 + 17);
      assert(hex(sha1(bytes)) === hex(await crypto.subtle.digest('SHA-1', bytes)), 'Independent SHA-1 size ' + size);
    }
    report.checks.push('Shared SHA-1 contract and seven independent WebCrypto vectors');
    const fixture = hierarchyFixture(), inputs = [inspector(fixture.a), inspector(fixture.b)];
    const index = new AssemblySymbolIndex(inputs), graph = new AssemblyTypeHierarchy(index, inputs);
    const root = inputs[0].tokenUri(fixture.tokens.root);
    const tree = graph.tree(root, { direction: 'implementers' });
    assert(walk(tree).map(node => node.symbol?.name).join('|') ===
      'Hierarchy.IRoot|Hierarchy.IChild|Hierarchy.Derived|Hierarchy.Further', 'Cross-image authored hierarchy');
    const arrays = [...inputs];
    arrays[Symbol.iterator] = function* () { yield this[0]; };
    arrays.map = () => { throw Error('Caller map used'); };
    assert(new AssemblyTypeHierarchy(index, arrays).storage.rows === graph.storage.rows, 'Numeric snapshot');
    rejects(() => new AssemblyTypeHierarchy(index, arrays, { maxRows: graph.storage.rows - 1 }), /limit exceeded/);
    rejects(() => graph.tree(root, { maxQueryNodes: 0 }), /limit exceeded/);
    rejects(() => graph.tree(root, { signal: AbortSignal.abort() }), /cancelled/);
    const expected = JSON.stringify(tree);
    tree.children[0].symbol.name = 'changed';
    inputs[0].pe.bytes.fill(0);
    assert(JSON.stringify(graph.tree(root, { direction: 'implementers' })) === expected, 'Owned graph/query snapshots');
    report.checks.push('Authored cross-image tree, iterator/map boundary, caps, cancellation and ownership');
    const native = await (await fetch('/tests/fixtures/type-hierarchy/native.json')).json();
    const assemblies = [];
    for (const image of native.images) {
      const bytes = Uint8Array.from(atob(image.bytes), character => character.charCodeAt(0));
      assert(hex(await crypto.subtle.digest('SHA-256', bytes)) === image.sha256, 'Native image hash');
      assemblies.push(new AssemblyInspector(bytes));
    }
    const nativeIndex = new AssemblySymbolIndex(assemblies), nativeGraph = new AssemblyTypeHierarchy(nativeIndex, assemblies);
    const positions = new Map(native.images.map((image, position) => [image.name, position]));
    const identity = value => positions.has(value.assembly) ? assemblies[positions.get(value.assembly)].tokenUri(value.token) : null;
    for (const definition of native.native.definitions) {
      const node = nativeGraph.tree(identity(definition.identity));
      assert(node.symbol.name === definition.identity.name && node.symbol.id.includes(definition.identity.mvid), 'Native identity');
      if (definition.baseType) assert((node.children[0].symbol?.id ?? null) === identity(definition.baseType), 'Native base target');
      if (definition.isInterface) {
        const actual = [...new Set(walk(nativeGraph.tree(node.symbol.id, { direction: 'implementers' })).slice(1)
          .map(value => value.symbol?.id).filter(Boolean))].sort();
        const expected = native.native.definitions.filter(type => type.interfaces.some(item => identity(item) === node.symbol.id))
          .map(type => identity(type.identity)).sort();
        assert(JSON.stringify(actual) === JSON.stringify(expected), 'Native implementer identities');
      }
    }
    const missing = new AssemblyTypeHierarchy(new AssemblySymbolIndex([assemblies[1]]), [assemblies[1]]);
    const derived = native.native.definitions.find(type => type.identity.name === 'NativeHierarchy.Derived');
    assert(missing.tree(assemblies[1].tokenUri(derived.identity.token)).children[0].diagnostic.reason === 'missing-assembly', 'Native absent A');
    assert(assemblies.every(value => value.cache.size === 0), 'No native method decoding');
    report.reference = { toolchain: native.toolchain, images: native.images.map(({ name, sha256 }) => ({ name, sha256 })) };
    report.checks.push('Two native images: eight type identities, cross-image/nested bases, implementer sets and absent assembly');
    report.passed = true;
  } catch (error) { report.error = { name: error.name, message: error.message }; }
  return report;
}
