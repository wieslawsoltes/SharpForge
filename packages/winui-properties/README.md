# @sharpforge/winui-properties

Framework-independent UI services with explicit application lifetimes.

## Member adapter registry

`UIExtensionRegistry` owns one application's managed/JavaScript member adapters.
Register an owner, member kind, name and optional arity with a synchronous handler.
Resolution uses exact arity before wildcard arity, then the host's declared base
chain. The host supplies canonical type names and base-type lookup; the registry
never imports or initializes a runtime, browser, renderer or framework registry.

`register()` returns an idempotent disposer. Duplicate registrations, invalid
arities and ancestry cycles fail explicitly. `invoke()` returns `{handled, value}`
for a registered member and `{handled: false}` otherwise. Asynchronous adapters
must return a task recognized by the host's explicit `isTask` service; arbitrary
Promises are rejected. `clear()` releases every registration for teardown.

Import `UIExtensionRegistry` from `@sharpforge/winui-properties`. The package's
additional property, binding and presentation services are published in dependent
feature batches. No framework contract or opcode identifiers change in this seam.
