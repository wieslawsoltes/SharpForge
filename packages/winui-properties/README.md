# @sharpforge/winui-properties

Application-owned UI services for SharpForge. Instances have explicit lifetimes; the package has no external runtime dependencies or import-time registrations.

## UI member adapters

`UIExtensionRegistry` registers constructor, method and property handlers by owner and signature. The injected context owns platform conversion and task handling.

## Dependency property registration

`DependencyPropertyRegistry` allocates immutable identities per owner and validates defaults before publishing them. Attached properties retain their declaring owner; inherited lookups reuse that identity. `PropertyMetadata` supplies callbacks, factory defaults and validation policy to the consuming host. Registry snapshots retain token identity and reject cross-registry tokens.

## Effective values

`PropertyStore` keeps the ordered value sources for one dependency object, applies inherited values, validates transactions before publication and emits effective changes through a bounded FIFO queue. Animation removal reveals the current underlying value. Snapshot and restore preserve callbacks and identity without replaying notifications. Read-only property writes require an injected host capability. `EffectiveValueEmitter` tracks weak consumers of mutable value nodes.
