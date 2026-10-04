import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {resultKinds, additionalShapes, evidence, unsupported} from './value-inventory-description.js';

export const root = fileURLToPath(new URL('../../', import.meta.url));

// These hashes identify the implementation reviewed by the descriptive inventory.
// They do not version the independent Portable Value ABI 1 codec.
const files = [
  'packages/runtime/src/heap.js',
  'packages/runtime/src/vm.js',
  'packages/runtime/src/cil-vm.js',
  'packages/runtime/src/execution/delegate-targets.js',
  'packages/runtime/src/execution/source-ops.js',
  'packages/runtime/src/execution/source-ops/load-store.js',
  'packages/runtime/src/execution/source-ops/arithmetic.js',
  'packages/runtime/src/execution/source-ops/control.js',
  'packages/runtime/src/execution/source-ops/call.js',
  'packages/runtime/src/execution/source-ops/object.js',
  'packages/runtime/src/execution/source-ops/index.js',
  'packages/runtime/src/execution/source-builtins.js',
  'packages/runtime/src/execution/source-builtins/objects.js',
  'packages/runtime/src/execution/source-builtins/collections.js',
  'packages/runtime/src/execution/source-builtins/services.js',
  'packages/runtime/src/execution/source-builtins/index.js',
  'packages/runtime/src/execution/storage.js',
  'packages/runtime/src/execution/numeric-ops.js',
  'packages/runtime/src/execution/enums.js',
  'packages/bytecode/src/index.js',
  'packages/bytecode/src/builtins.js',
  'packages/bytecode/src/numeric/conversions.js',
  'packages/bytecode/src/numeric/float.js',
  'packages/bytecode/src/numeric/native-int.js',
  'packages/bytecode/src/numeric/decimal-value.js',
  'packages/bytecode/src/numeric/scalar-codec.js',
  'packages/runtime/src/execution/source-numbers.js',
  'packages/runtime/src/execution/managed-fault.js',
  'packages/runtime/src/execution/heap-reference.js',
  'packages/runtime/src/execution/heap-storage.js',
  'packages/runtime/src/execution/array-storage.js',
  'packages/runtime/src/execution/value-types.js',
  'packages/runtime/src/execution/explicit-values.js',
  'packages/runtime/src/execution/nullable-value.js',
  'packages/runtime/src/execution/nullable-interior.js',
  'packages/runtime/src/execution/managed-address.js',
  'packages/runtime/src/execution/source-addresses.js',
  'packages/runtime/src/execution/stack-memory.js',
  'packages/runtime/src/execution/pinned.js',
  'packages/runtime/src/execution/spans.js',
  'packages/runtime/src/execution/varargs.js',
  'packages/runtime/src/execution/method-pointers.js',
  'packages/runtime/src/execution/typed-stack.js',
  'packages/runtime/src/execution/snapshot-version.js',
  'packages/runtime/src/execution/snapshot-serialize.js',
  'packages/runtime/src/execution/snapshot-wire-values.js',
  'packages/runtime/src/execution/snapshot-cow.js',
];

export function inventory(base = root) {
  const sources = Object.fromEntries(files.map(path => [path,
    createHash('sha256').update(readFileSync(resolve(base, path))).digest('hex')]));
  return {schemaVersion: 1, sources, resultKinds, additionalShapes, evidence, unsupported};
}

export function inventoryText(base = root) {
  return JSON.stringify(inventory(base), null, 2) + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = resolve(root, 'planning/contracts/value-abi/current-js-inventory.json');
  const text = inventoryText();
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== text) throw new Error('Value inventory drift; regenerate and review');
  } else writeFileSync(path, text);
}
