import {registerGCRuntimeContracts} from './gc-runtime-contracts.js';
import {registerGCFixedContracts} from './gc-fixed-contracts.js';
import {registerGCScalarContracts} from './gc-scalar-contracts.js';
import {registerGCArrayContracts} from './gc-array-contracts.js';
const GC = 'System.GC';
const SETTINGS = 'System.Runtime.GCSettings';
const HANDLE = 'System.Runtime.InteropServices.GCHandle';
const HANDLE_TYPE = 'System.Runtime.InteropServices.GCHandleType';

/** A06 owns its reserved ABI range. Existing framework and builtin IDs are untouched. */
export function registerGCContracts(registry) {
  const {define, member, prop, en, ctor} = registry;
  const gcEnum = (name, values) => Object.assign(en(name, values), {gcEnum: true});
  define(GC, {kind: 'static', runtimeHandler: 'gc', family: 'gc'});
  gcEnum('System.GCCollectionMode', {Default: 0, Forced: 1, Optimized: 2, Aggressive: 3});
  gcEnum('System.GCKind', {Any: 0, Ephemeral: 1, FullBlocking: 2, Background: 3});
  gcEnum('System.GCNotificationStatus', {Succeeded: 0, Failed: 1, Canceled: 2, Timeout: 3, NotApplicable: 4});
  gcEnum('System.Runtime.GCLatencyMode', {Batch: 0, Interactive: 1, LowLatency: 2, SustainedLowLatency: 3, NoGCRegion: 4});
  gcEnum('System.Runtime.GCLargeObjectHeapCompactionMode', {Default: 1, CompactOnce: 2});
  const collectParameters = ['int', 'System.GCCollectionMode', 'bool', 'bool'];
  for (let count = 0; count <= collectParameters.length; count++) {
    member(GC, 'Collect', collectParameters.slice(0, count), 'void', {
      isStatic: true, ...(count === 0 ? {legacyBuiltin: 'GC.Collect'} : {})
    });
  }
  prop(GC, 'MaxGeneration', 'int', 2, true, true);
  member(GC, 'GetGeneration', ['object'], 'int', {isStatic: true});
  member(GC, 'GetGeneration', ['System.WeakReference'], 'int', {isStatic: true});
  member(GC, 'CollectionCount', ['int'], 'int', {isStatic: true, legacyBuiltin: 'GC.CollectionCount'});
  member(GC, 'GetTotalMemory', ['bool'], 'long', {
    isStatic: true, legacyBuiltin: 'GC.GetTotalMemory', parameterDefaults: Object.freeze([false])
  });
  for (const parameters of [[], ['bool']]) member(GC, 'GetTotalAllocatedBytes', parameters, 'long', {isStatic: true});
  member(GC, 'GetAllocatedBytesForCurrentThread', [], 'long', {isStatic: true});
  for (const parameters of [[], ['System.GCKind']]) member(GC, 'GetGCMemoryInfo', parameters, 'System.GCMemoryInfo', {isStatic: true});
  for (const name of ['AddMemoryPressure', 'RemoveMemoryPressure']) member(GC, name, ['long'], 'void', {isStatic: true});
  for (const name of ['KeepAlive', 'SuppressFinalize', 'ReRegisterForFinalize']) member(GC, name, ['object'], 'void', {isStatic: true});
  member(GC, 'WaitForPendingFinalizers', [], 'void', {isStatic: true});
  member(GC, 'RegisterForFullGCNotification', ['int', 'int'], 'void', {isStatic: true});
  member(GC, 'CancelFullGCNotification', [], 'void', {isStatic: true});
  for (const name of ['WaitForFullGCApproach', 'WaitForFullGCComplete']) {
    for (const parameters of [[], ['int']]) member(GC, name, parameters, 'System.GCNotificationStatus', {isStatic: true});
  }
  for (const parameters of [['long'], ['long', 'bool'], ['long', 'long'], ['long', 'long', 'bool']]) {
    member(GC, 'TryStartNoGCRegion', parameters, 'bool', {isStatic: true});
  }
  member(GC, 'EndNoGCRegion', [], 'void', {isStatic: true});
  define(SETTINGS, {kind: 'static', runtimeHandler: 'gc', family: 'gcSettings'});
  prop(SETTINGS, 'IsServerGC', 'bool', false, true, true);
  prop(SETTINGS, 'LatencyMode', 'System.Runtime.GCLatencyMode', 1, false, true);
  prop(SETTINGS, 'LargeObjectHeapCompactionMode', 'System.Runtime.GCLargeObjectHeapCompactionMode', 1, false, true);
  registerMemoryInfo(registry);
  define('System.WeakReference', {kind: 'gc', family: 'gcWeakReference'});
  ctor('System.WeakReference', ['object']);
  ctor('System.WeakReference', ['object', 'bool']);
  prop('System.WeakReference', 'Target', 'object');
  prop('System.WeakReference', 'IsAlive', 'bool', false, true);
  prop('System.WeakReference', 'TrackResurrection', 'bool', false, true);
  gcEnum(HANDLE_TYPE, {Weak: 0, WeakTrackResurrection: 1, Normal: 2, Pinned: 3});
  define(HANDLE, {kind: 'value', runtimeHandler: 'gc', family: 'gcHandle', base: 'System.ValueType'});
  member(HANDLE, 'Alloc', ['object'], HANDLE, {isStatic: true});
  member(HANDLE, 'Alloc', ['object', HANDLE_TYPE], HANDLE, {isStatic: true});
  prop(HANDLE, 'Target', 'object');
  prop(HANDLE, 'IsAllocated', 'bool', false, true);
  member(HANDLE, 'Free', [], 'void');
  member(HANDLE, 'AddrOfPinnedObject', [], 'nint');
  member(HANDLE, 'ToIntPtr', [HANDLE], 'nint', {isStatic: true});
  member(HANDLE, 'FromIntPtr', ['nint'], HANDLE, {isStatic: true});
  registerGenericLifetime(registry);
  registerSafeHandle(registry);
  registerGCScalarContracts(registry);
  registerGCRuntimeContracts(registry);
  registerGCFixedContracts(registry);
  registerGCArrayContracts(registry);
}

function registerMemoryInfo(registry) {
  const {define, prop} = registry;
  define('System.GCMemoryInfo', {kind: 'value', runtimeHandler: 'gc', family: 'gcMemoryInfo', base: 'System.ValueType'});
  for (const name of ['HighMemoryLoadThresholdBytes', 'MemoryLoadBytes', 'TotalAvailableMemoryBytes', 'HeapSizeBytes',
    'FragmentedBytes', 'TotalCommittedBytes', 'PromotedBytes', 'PinnedObjectsCount', 'FinalizationPendingCount', 'Index']) {
    prop('System.GCMemoryInfo', name, 'long', 0, true);
  }
  prop('System.GCMemoryInfo', 'Generation', 'int', 0, true);
  prop('System.GCMemoryInfo', 'PauseTimePercentage', 'double', 0, true);
  prop('System.GCMemoryInfo', 'Compacted', 'bool', false, true);
  prop('System.GCMemoryInfo', 'Concurrent', 'bool', false, true);
  prop('System.GCMemoryInfo', 'GenerationInfo', 'System.ReadOnlySpan`1<System.GCGenerationInfo>', null, true);
  prop('System.GCMemoryInfo', 'PauseDurations', 'System.ReadOnlySpan`1<System.TimeSpan>', null, true);
  define('System.GCGenerationInfo', {kind: 'value', runtimeHandler: 'gc', family: 'gcGenerationInfo', base: 'System.ValueType'});
  for (const name of ['SizeBeforeBytes', 'FragmentationBeforeBytes', 'SizeAfterBytes', 'FragmentationAfterBytes']) {
    prop('System.GCGenerationInfo', name, 'long', 0, true);
  }
  registerReadOnlySpan(registry, 'System.GCGenerationInfo');
  registerReadOnlySpan(registry, 'System.TimeSpan');
}

function registerReadOnlySpan({define, prop, member, aliases}, element) {
  const owner = 'System.ReadOnlySpan`1<' + element + '>';
  define(owner, {kind: 'value', runtimeHandler: 'gc', family: 'gcReadOnlySpan',
    base: 'System.ValueType', element, isReadOnly: true, isRefLikeType: true});
  aliases.set('ReadOnlySpan<' + element.slice('System.'.length) + '>', owner);
  aliases.set('System.ReadOnlySpan<' + element + '>', owner);
  prop(owner, 'Length', 'int', 0, true);
  prop(owner, 'IsEmpty', 'bool', true, true);
  const sourceBridge = Object.freeze({name: '$get_ItemValue', parameters: Object.freeze(['int']), result: element});
  member(owner, 'get_Item', ['int'], element + '&', {returnRefKind: 'ref readonly', sourceBridge});
  member(owner, '$get_ItemValue', ['int'], element, {internal: true});
  member(owner, 'ToArray', [], element + '[]');
}

function sourceByRef(member, owner, name, parameters, outIndex) {
  const result = 'bool';
  const sourceParameters = parameters.map((parameter, index) => index === outIndex ? 'object' : parameter);
  const sourceBridge = Object.freeze({name: '$' + name + 'Cell', parameters: Object.freeze(sourceParameters), result});
  const parameterRefKinds = parameters.map((parameter, index) => index === outIndex ? 'out' : 'none');
  member(owner, name, parameters, result, {sourceByRefCells: true, parameterRefKinds: Object.freeze(parameterRefKinds), sourceBridge});
  member(owner, sourceBridge.name, sourceParameters, result, {internal: true});
}

function registerGenericLifetime({define, ctor, prop, member, delegate, aliases, types}) {
  for (const element of ['object', 'string']) {
    const owner = 'System.WeakReference`1<' + element + '>';
    define(owner, {kind: 'gc', family: 'gcWeakReference', element});
    aliases.set('WeakReference<' + element + '>', owner);
    aliases.set('System.WeakReference<' + element + '>', owner);
    ctor(owner, [element]);
    ctor(owner, [element, 'bool']);
    member(owner, 'SetTarget', [element], 'void');
    sourceByRef(member, owner, 'TryGetTarget', [element + '&'], 0);
  }
  for (const [key, value] of [['object', 'object'], ['string', 'string'], ['string', 'object'], ['object', 'string']]) {
    const owner = 'System.Runtime.CompilerServices.ConditionalWeakTable`2<' + key + ', ' + value + '>';
    define(owner, {kind: 'gc', family: 'gcConditionalWeakTable', key, element: value});
    aliases.set('ConditionalWeakTable<' + key + ', ' + value + '>', owner);
    ctor(owner);
    member(owner, 'Add', [key, value], 'void');
    member(owner, 'Remove', [key], 'bool');
    member(owner, 'Clear', [], 'void');
    sourceByRef(member, owner, 'TryGetValue', [key, value + '&'], 1);
    const callback = owner + '.CreateValueCallback';
    delegate(callback, [key], value);
    Object.assign(types.get(callback), {declaringType: owner, nestedName: 'CreateValueCallback'});
    const callbackDefinition = 'System.Runtime.CompilerServices.ConditionalWeakTable`2+CreateValueCallback';
    const systemName = type => type === 'object' ? 'System.Object' : 'System.String';
    for (const keyName of [key, systemName(key)]) {
      for (const valueName of [value, systemName(value)]) {
        aliases.set(callbackDefinition + '<' + keyName + ', ' + valueName + '>', callback);
      }
    }
    const sourceBridge = Object.freeze({name: '$GetValueDelegate', parameters: Object.freeze([key, 'object']), result: value});
    member(owner, 'GetValue', [key, callback], value, {sourceDelegates: true, sourceBridge});
    member(owner, sourceBridge.name, sourceBridge.parameters, value, {internal: true});
  }
}

function registerSafeHandle({define, ctor, prop, member, types}) {
  const critical = 'System.Runtime.ConstrainedExecution.CriticalFinalizerObject';
  const owner = 'System.Runtime.InteropServices.SafeHandle';
  define(critical, {kind: 'abstract', runtimeHandler: 'gc', family: 'gcCriticalFinalizerObject'});
  member(critical, '.ctor', [], critical, {kind: 'constructor', accessibility: 'protected',
    sourceInitializer: '$InitializeCriticalFinalizer'});
  member(critical, '$InitializeCriticalFinalizer', ['object'], 'void', {isStatic: true, internal: true});
  define(owner, {kind: 'abstract', runtimeHandler: 'gc', family: 'gcSafeHandle', base: critical});
  member(owner, '.ctor', ['nint', 'bool'], owner, {kind: 'constructor', accessibility: 'protected',
    sourceInitializer: '$InitializeSafeHandle'});
  member(owner, '$InitializeSafeHandle', ['object', 'nint', 'bool'], 'void', {isStatic: true, internal: true});
  prop(owner, 'IsClosed', 'bool', false, true);
  types.get(owner).properties.IsInvalid = {type: 'bool', value: true, readOnly: true, isStatic: false};
  member(owner, 'get_IsInvalid', [], 'bool', {kind: 'get', property: 'IsInvalid', isAbstract: true, isVirtual: true});
  member(owner, 'DangerousGetHandle', [], 'nint');
  const sourceBridge = Object.freeze({name: '$DangerousAddRefCell', parameters: Object.freeze(['object']), result: 'void'});
  member(owner, 'DangerousAddRef', ['bool&'], 'void', {
    sourceByRefCells: true, parameterRefKinds: Object.freeze(['ref']), sourceBridge
  });
  member(owner, sourceBridge.name, sourceBridge.parameters, 'void', {internal: true});
  for (const name of ['DangerousRelease', 'SetHandleAsInvalid', 'Close', 'Dispose']) member(owner, name, [], 'void');
  member(owner, 'SetHandle', ['nint'], 'void', {accessibility: 'protected'});
  member(owner, 'ReleaseHandle', [], 'bool', {isAbstract: true, isVirtual: true, accessibility: 'protected'});
  types.get(owner).properties.handle = {type: 'nint', value: 0, readOnly: false, isStatic: false};
  member(owner, '$get_Handle', [], 'nint', {kind: 'get', property: 'handle', internal: true, accessibility: 'protected'});
  member(owner, '$set_Handle', ['nint'], 'void', {kind: 'set', property: 'handle', internal: true, accessibility: 'protected'});
}
