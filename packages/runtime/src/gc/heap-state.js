import {MethodTableRegistry} from '../execution/method-table.js';
import {HandleTable} from './handle-table.js';
import {TypeDescriptors} from './type-descriptor.js';
import {createStats} from './stats.js';
import {HeapBarriers} from './barrier.js';
import {Collector} from './collector.js';
import {LifetimeManager} from './lifetime.js';
import {HeapSpaces} from './spaces.js';
import {HeapLimits} from './limits.js';
import {SafepointCoordinator} from './safepoints.js';
import {BackgroundMarker} from './background-mark.js';
import {GCSettings} from './settings.js';
import {GCEvents} from './events.js';
import {GCNotifications} from './notifications.js';
import {MemoryPressure} from './memory-pressure.js';
import {GCCounters} from './counters.js';
import {parseGCConfiguration} from './config.js';
import {HeapDiagnostics} from './diagnostics.js';
import {AllocationSites} from './allocation-sites.js';
import {RootRegistry} from './roots.js';
import {GCStress} from './stress.js';
import {rootReference} from './reference.js';

const noRoots = () => [];

/** Composition belongs here; collector services have no import cycle through the heap. */
export function initializeHeap(heap, options) {
  const configuration = parseGCConfiguration(options);
  const effective = {...options, ...configuration, gcConfiguration: configuration};
  const maxBytes = effective.maxBytes ?? 32 * 1024 * 1024;
  const initialThreshold = effective.initialThreshold ?? 64 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(initialThreshold) || initialThreshold < 1) {
    throw new RangeError('Heap sizes must be positive safe integers');
  }
  heap.options = effective;
  heap.configuration = configuration;
  heap.methodTables = options.methodTables ?? new MethodTableRegistry();
  heap.maxBytes = maxBytes;
  heap.initialThreshold = initialThreshold;
  heap.threshold = Math.min(initialThreshold, maxBytes);
  heap.maxArrayLength = options.maxArrayLength ?? 1_000_000;
  if (!Number.isSafeInteger(heap.maxArrayLength) || heap.maxArrayLength < 0 || heap.maxArrayLength > 0x7fffffff) {
    throw new RangeError('Invalid managed array element limit');
  }
  heap.mutationRevision = 0;
  heap.generationCounter = 0;
  heap.allocatedBytes64 = 0n;
  heap.records = [];
  heap.generations = [];
  heap.free = [];
  heap.rootProvider = noRoots;
  heap.rootVisitor = null;
  heap.rootRegistry = new RootRegistry();
  heap.pins = [];
  heap.handles = new Map();
  heap.handleOwner = Object.freeze({});
  heap.snapshotOwner = Object.freeze({});
  heap.nextHandleId = 1;
  heap.marks = new Uint32Array(0);
  heap.markEpoch = 0;
  heap.markWork = [];
  heap.closed = false;
  heap.currentThreadId = () => 0;
  heap.allocationContexts = new Set();
  heap._pinEdge = value => {
    const reference = rootReference(value);
    if (reference) heap.pinRoot(reference);
  };
  heap.stats = createStats(heap);
  heap.descriptors = new TypeDescriptors({...effective, storageFor: record => heap.spaces.getBinding(record)});
  heap.handleTable = new HandleTable(heap, effective);
  heap.limits = new HeapLimits(heap, effective);
  heap.events = new GCEvents(effective);
  heap.spaces = new HeapSpaces(heap, effective);
  heap.lifetime = new LifetimeManager(heap, effective);
  heap.settings = new GCSettings(heap, effective);
  heap.notifications = new GCNotifications(heap, effective);
  heap.pressure = new MemoryPressure(heap, effective);
  heap.safepoints = new SafepointCoordinator(heap, effective);
  heap.collector = new Collector(heap, effective);
  heap.barriers = new HeapBarriers(heap);
  heap.allocationSites = new AllocationSites(effective);
  heap.diagnostics = new HeapDiagnostics(heap, effective);
  heap.counters = new GCCounters(heap, effective);
  heap.gcStress = new GCStress(heap, options.gcStress);
  heap.background = new BackgroundMarker(heap, effective);
}
