// Current JS carriers, independent of the Portable Value ABI 1 interchange format.
const any = 'number | bigint | null | undefined | {h,g} | float | nativeInt | Decimal | byref | methodPointer | frozen struct | frozen Nullable';

export const resultKinds = {
  int: {source: 'number (Int32 narrowed by bitwise operations)', cil: 'number (Int32 stack category)'},
  enum: {
    source: 'frozen {enumType, underlyingType, value: number | bigint}',
    cil: 'underlying stack integer or boxed managed enum'
  },
  long: {source: 'bigint (signed Int64)', cil: 'bigint (signed Int64)'},
  double: {
    source: 'number | frozen {float: r8, value: number} (IEEE 754 binary64)',
    cil: 'frozen {float: r8, value: number}'
  },
  numeric: {
    source: 'number | bigint | frozen float | nativeInt | Decimal',
    cil: 'number | bigint | frozen {float: r4|r8, value: number} | frozen {nativeInt: 32|64, value: number|bigint} | Decimal'
  },
  bool: {source: 'boolean', cil: 'number (0 or 1)'},
  string: {source: 'frozen {h,g} to UTF-16 string record', cil: 'frozen {h,g} to UTF-16 string record'},
  array: {source: 'frozen {h,g} to array record', cil: 'frozen {h,g} to array record'},
  exception: {source: 'ManagedFault with optional reference, frames', cil: 'ManagedFault with optional reference, frames'},
  any: {source: any + ' | boolean | enum | Span | TypedReference | runtime handle | ArgIterator',
    cil: any + ' | Span | TypedReference | runtime handle | ArgIterator'}
};

export const additionalShapes = [
  {
    shape: '{nullableType:MethodTable,hasValue:boolean,value}',
    meaning: 'immutable source/CIL Nullable with an admitted copied payload, including nested managed references, or null; '
      + 'boxes as null or underlying T; portable snapshot serialization rebinds the owned type and references'
  },
  {
    shape: '{valueType:MethodTable,fields:frozen array}',
    meaning: 'immutable VM-owned admitted source/CIL struct; nested values are copied and owned reference fields retain identity; '
      + 'portable snapshot serialization rebinds the owned type and references'
  },
  {
    shape: '{valueType:MethodTable,fields:frozen array,explicitBytes:frozen byte array,explicitReferences?:frozen array}',
    meaning: 'admitted explicit-layout value with immutable little-endian bytes and a separate managed-reference sidecar; '
      + 'copies preserve padding and scalar bits; reference overlap requires validated layout'
  },
  {
    shape: '{byref:true,vmOwner,kind,index,owner,frameId,path:frozen array,readonly?}',
    meaning: 'owned immutable source/CIL address; paths contain struct field indices or the validated nullableValue step; '
      + 'access checks live storage, VM ownership, readonly state and frame lifetime'
  },
  {
    shape: '{byref:true,memoryPointer:true,vmOwner,kind,index,baseType,frameId,regionId|leaseId|source,path,readonly}',
    meaning: 'owned stack, pinned or reinterpreted memory capability with a bounded byte offset; '
      + 'region or pin lifetime is validated; never a native host address'
  },
  {
    shape: '{decimal:true,coefficient:bigint,scale:0..28,negative:boolean}',
    meaning: 'immutable System.Decimal value, unsigned 96-bit coefficient; exact source/CIL arithmetic, storage and boxing; '
      + 'the JS carrier is distinct from either portable codec encoding'
  },
  {
    shape: '{nativeInt:32|64,value:number|bigint}',
    meaning: 'immutable source/CIL native-integer stack category at the configured ABI width; not a portable pointer'
  },
  {shape: '{enumType,underlyingType,value}', meaning: 'source enum identity with signed or unsigned integer storage; not a heap reference'},
  {shape: 'null', meaning: 'null reference and default reference storage'},
  {shape: 'undefined', meaning: 'unassigned local; portable snapshots encode this explicitly, Portable Value ABI 1 does not'},
  {
    shape: '{h,g}',
    meaning: 'zero-based heap index and positive safe-integer generation, with allocation provenance held outside the frozen object; '
      + 'isReference checks shape only; ownership and live generation require separate checks'
  },
  {
    shape: '{methodPointer:true,vmOwner,token}',
    meaning: 'immutable owned method pointer with exact resolved method identity; delegate binding rejects a foreign VM; '
      + 'portable snapshots rebind an admitted method identity, never a raw function pointer'
  },
  {shape: 'host lease {id,owner}', meaning: 'heap-local opaque strong or weak handle'},
  {
    shape: '{span:true,vmOwner,elementType,pointer,length,readonly}',
    meaning: 'immutable owned bounded view over array, readonly string or admitted raw storage; '
      + 'access validates element identity, bounds, lifetime and readonly state'
  },
  {
    shape: '{typedReference:true,vmOwner,pointer,type}',
    meaning: 'immutable owned typed managed address; exact declared type and location lifetime are checked on access'
  },
  {
    shape: '{runtimeArgumentHandle:true,vmOwner,frameId} | {argIterator:true,vmOwner,frameId,index,ended}',
    meaning: 'immutable owned managed varargs packet handle or cursor; the declaring frame must remain live'
  },
  {
    shape: '{runtimeHandle:type,owner,table,token}',
    meaning: 'opaque owned runtime type identity, distinct from an allocated System.Type object and a native address'
  },
  {
    shape: 'array record data: typed array | Array',
    meaning: 'primitive elements use contiguous declared-width backing; reference and aggregate arrays use managed slots; '
      + 'snapshot backing is copied or retained through immutable copy-on-write buffers'
  },
  {
    shape: 'NumericSlots numeric planes and reference slots',
    meaning: 'internal typed frame storage can keep float and small Int64 values unboxed; reads materialize the public scalar carrier; '
      + 'this internal representation does not change Portable Value ABI 1 tags'
  }
];

export const evidence = [
  'execution/source-builtins.js and source-builtins/ groups preserve rooted intrinsic results and VM-local result/host metadata',
  'execution/source-ops/ groups preserve source opcode stack values, storage writes, arithmetic, control flow and object construction',
  'execution/heap-reference.js issues frozen {h,g} references and tracks allocation provenance separately from shape and liveness',
  'execution/heap-storage.js derives array capacity from element width, maxBytes, maxArrayLength and the 0xffffffff addressing bound',
  'execution/array-storage.js preserves declared primitive widths; reference and aggregate arrays retain managed slots',
  'execution/storage.js and execution/numeric-ops.js normalize narrow and BigInt integer categories through shared scalar helpers',
  'execution/enums.js, bytecode/numeric/float.js and bytecode/numeric/native-int.js freeze their scalar carriers',
  'execution/value-types.js admits copied source/CIL values with owned assignable reference fields and validated managed layouts',
  'execution/explicit-values.js preserves explicit bytes and managed-reference sidecars without exposing host pointers',
  'execution/nullable-value.js copies admitted payloads and execution/nullable-interior.js validates writable payload aliases',
  'execution/spans.js and execution/varargs.js keep views, typed references and packet cursors bound to owned storage lifetimes',
  'execution/delegate-targets.js preserves exact method-pointer ownership during delegate construction',
  'bytecode/numeric/decimal-value.js preserves unsigned 96-bit coefficient, scale and sign',
  'execution/typed-stack.js numeric planes are an internal storage optimization; generic reads retain scalar semantics',
  'execution/snapshot-serialize.js uses its own versioned graph format with exact code identity, native width and host-revision checks',
  'execution/snapshot-version.js execution schema and the portable snapshot format are separate from Portable Value ABI 1'
];

export const unsupported = [
  'Rust engine qualification by this JS representation inventory',
  'Cross-platform or browser execution qualification by this JS representation inventory',
  'Arbitrary CLR layouts or ref structs outside the explicit runtime admission profiles',
  'Raw VM-owned JS objects as Portable Value ABI 1 wire data; the independent ABI codec requires its declared envelope'
];
