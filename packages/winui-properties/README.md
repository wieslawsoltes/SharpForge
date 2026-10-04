# @sharpforge/winui-properties

Application-owned UI services for SharpForge. Instances have explicit lifetimes; the package has no external runtime dependencies or import-time registrations.

## UI member adapters

`UIExtensionRegistry` registers constructor, method and property handlers by owner and signature. The injected context owns platform conversion and task handling.

## Resources and scopes

`ResourceDictionary` supports keyed entries, reverse-order merged lookup, theme dictionaries and transactional mutation. Cycle, size and reentrancy limits are checked before publication. `ResourceScope` searches local and ancestor scopes and observes resource changes with explicit disposal. `StaticResource` references capture a value; `ThemeResource` references follow the live scope. `DeferredResource` constructs a resource once and owns its lifetime.
