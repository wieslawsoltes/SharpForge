import {RootCategory, visitRootValue} from './roots.js';
import {ManagedFault} from './fault.js';

/** Explicit A04 host registry bridge; metadata contexts do not become managed heap records. */
export class ContextRootBridge {
  constructor(runtime, registry) {
    if (!registry || typeof registry.enumerate !== 'function' || typeof registry.subscribe !== 'function') {
      throw new TypeError('Context roots require enumeration and publication subscriptions');
    }
    this.runtime = runtime;
    this.registry = registry;
    this.publish = reference => runtime.vm.heap.collector.rootBarrier(reference);
    this.subscription = registry.subscribe(entry => {
      if (!entry.weak) visitRootValue(entry.target, this.publish, RootCategory.Interop);
    });
    this.registration = runtime.rootRegistry.register(RootCategory.Interop, visitor => this.visitRoots(visitor), registry);
    try {
      this.visitRoots(this.publish);
      runtime.contextRoots.add(this);
    } catch (error) {
      this.subscription.dispose();
      this.registration.dispose();
      throw error;
    }
  }

  visitRoots(visitor) {
    for (const entry of this.registry.enumerate()) {
      if (!entry.weak) visitRootValue(entry.target, visitor,
        entry.kind === 'static' ? RootCategory.Static : RootCategory.Interop, `assembly-context:${entry.kind}`);
    }
  }

  dispose() {
    this.subscription.dispose();
    this.registration.dispose();
    this.runtime.contextRoots.delete(this);
  }
}

/** A host context registry cannot be rewound by copying one VM's managed heap. */
export function assertContextRootsRestorable(runtime, state) {
  const saved = state?.contextRoots ?? [];
  if (saved.length !== runtime.contextRoots.size || saved.some(entry =>
    !runtime.contextRoots.has(entry.bridge) || entry.bridge.registry.revision !== entry.revision)) {
    throw new ManagedFault('InvalidOperationException', 'Snapshot cannot cross a host assembly-context root change');
  }
}
