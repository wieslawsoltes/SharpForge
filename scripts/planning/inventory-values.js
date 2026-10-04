import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));

// Follow the actual carrier owners after extraction; a facade hash alone misses representation drift.
const files = [
  'packages/runtime/src/heap.js',
  'packages/runtime/src/gc/heap.js',
  'packages/runtime/src/gc/heap-state.js',
  'packages/runtime/src/gc/handle-table.js',
  'packages/runtime/src/gc/reference.js',
  'packages/runtime/src/gc/allocation.js',
  'packages/runtime/src/gc/api-array.js',
  'packages/runtime/src/gc/boolean-storage.js',
  'packages/runtime/src/gc/primitive-storage.js',
  'packages/runtime/src/gc/fault.js',
  'packages/runtime/src/gc/host-handles.js',
  'packages/runtime/src/gc/gc-handle.js',
  'packages/runtime/src/gc/address-space.js',
  'packages/runtime/src/gc/interior.js',
  'packages/runtime/src/gc/memory-span.js',
  'packages/runtime/src/gc/fixed-memory.js',
  'packages/runtime/src/gc/scalars.js',
  'packages/runtime/src/execution/source-ops.js',
  'packages/runtime/src/execution/source-values.js',
  'packages/runtime/src/execution/numeric-ops.js',
  'packages/runtime/src/execution/enums.js',
  'packages/runtime/src/execution/managed-address.js',
  'packages/runtime/src/execution/cil-array-storage.js',
  'packages/runtime/src/execution/delegate-targets.js',
  'packages/runtime/src/execution/handlers/call.js',
  'packages/runtime/src/vm.js',
  'packages/runtime/src/cil-vm.js',
  'packages/runtime/src/platform.js',
  'packages/bytecode/src/index.js',
  'packages/bytecode/src/builtins.js',
  'packages/bytecode/src/numeric/float.js',
  'packages/bytecode/src/numeric/int64.js'
];

const resultKinds = {
  int: {source: 'number (Int32 narrowed by bitwise operations)', cil: 'number (Int32 stack category)'},
  enum: {
    source: 'frozen {enumType, underlyingType, value: number | bigint}',
    cil: 'underlying stack integer or boxed managed enum'
  },
  long: {source: 'bigint (signed Int64)', cil: 'bigint (signed Int64)'},
  double: {
    source: 'number (IEEE 754 binary64)',
    cil: '{float: r8, value: number}; arithmetic and literal constructors freeze the carrier'
  },
  numeric: {source: 'number | bigint', cil: 'number | bigint | {float: r4|r8, value: number}'},
  bool: {source: 'boolean', cil: 'number (Int32 stack category; Boolean storage retains UInt8 bits; ordinary managed array views read boolean)'},
  string: {source: 'frozen {h,g} to UTF-16 string record', cil: 'frozen {h,g} to UTF-16 string record'},
  array: {source: 'frozen {h,g} to array record', cil: 'frozen {h,g} to array record'},
  exception: {source: 'ManagedFault with optional reference, frames', cil: 'ManagedFault with optional reference, frames'},
  any: {
    source: 'number | bigint | boolean | null | undefined | {h,g} | enum carrier | opaque GC token',
    cil: 'number | bigint | null | undefined | {h,g} | float | byref | methodPointer | opaque GC token'
  }
};

const additionalShapes = [
  {shape: '{enumType, underlyingType, value}',
    meaning: 'source enum identity with signed or unsigned integer storage; not a heap reference'},
  {shape: 'null', meaning: 'null reference and default reference storage'},
  {shape: 'undefined', meaning: 'unassigned local; not a portable value'},
  {shape: '{h,g}',
    meaning: 'zero-based heap slot and positive per-slot safe-integer identity; generation high-water marks survive restore'},
  {shape: '{byref:true,kind,index,owner,frameId,readOnly?}',
    meaning: 'CIL managed interior/frame address; readonly span addresses retain their array owner; never a raw pointer'},
  {shape: '{byref:true,kind:managed-interior,heapOwner,owner,path,readOnly}',
    meaning: 'heap-owned interior slot path; owner rooting is independent of pinning and rejects foreign/stale identities'},
  {shape: '{methodPointer:true,vmOwner,token}', meaning: 'immutable VM-owned CIL ldftn pointer identity'},
  {shape: 'host lease {id,owner}',
    meaning: 'heap-local opaque handle; strength, pinning, dependent target and root category live in the owning side table'},
  {shape: '{kind:gc-handle-token,owner,value:bigint,valueOf}',
    meaning: 'opaque GCHandle.ToIntPtr identity scoped to its heap; not a numeric host address or portable value'},
  {shape: 'ManagedAddress {kind:managed-address,owner,value:bigint}',
    meaning: 'session-scoped virtual byte address of pinned storage; no JavaScript/native pointer is exposed'},
  {shape: 'fixed pointer {h,g} to SharpForge.Runtime.FixedPointer',
    meaning: 'managed wrapper retaining a scoped pin lease, element type, byte offset and ManagedAddress'},
  {shape: 'native integer number',
    meaning: 'current numeric conv.i/conv.u profile is 32-bit; opaque GC tokens are separate from numeric nint arithmetic'}
];

/** Reproducible source review of current JS carriers, independent of Portable Value ABI 1. */
export function inventory(base = root) {
  const sources = Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(readFileSync(resolve(base, file), 'utf8')).digest('hex')]));
  return {
    schemaVersion: 1, sources,
    resultKinds: Object.fromEntries(Object.entries(resultKinds).map(([kind, carrier]) => [kind, {...carrier}])),
    additionalShapes: additionalShapes.map(shape => ({...shape})),
    evidence: [
      'HandleTable.allocate returns Object.freeze({h,g}); reuse increments a per-slot identity',
      'ManagedHeap.array defaults to 1000000 elements; configurable maxArrayLength remains within non-negative Int32',
      'CIL numeric-ops storage/convert implements narrow, native-32 and BigInt integer categories',
      'Source numeric modes retain Number/Int32 behavior; GC scalar lowering reuses exact CIL integer operations',
      'Bytecode float constructors freeze tagged F values; ManagedPlatform.managed may return an unfrozen r8 tag',
      'Host handles, GCHandle tokens, managed byrefs and virtual pinned addresses remain owner-scoped JS carriers'
    ],
    unsupported: [
      'Rust engine qualification', 'Wasm runtime qualification', 'decimal execution parity',
      'arbitrary value structs in source VM', 'portable encoding of opaque runtime handles, byrefs or virtual addresses'
    ]
  };
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
