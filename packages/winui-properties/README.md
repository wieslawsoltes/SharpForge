# @sharpforge/winui-properties

Application-owned UI services for SharpForge. Instances have explicit lifetimes; the package has no external runtime dependencies or import-time registrations.

## UI member adapters

`UIExtensionRegistry` registers constructor, method and property handlers by owner and signature. The injected context owns platform conversion and task handling.

## Dependency property registration

`DependencyPropertyRegistry` allocates immutable identities per owner and validates defaults before publishing them. Attached properties retain their declaring owner; inherited lookups reuse that identity. `PropertyMetadata` supplies callbacks, factory defaults and validation policy to the consuming host. Registry snapshots retain token identity and reject cross-registry tokens.

## Compiled binding descriptors

Version 1 descriptors contain bounded metadata tokens and immutable expression data. Validation rejects accessors, executable values, foreign versions and malformed paths without invoking supplied getters. The shipped JSON schema describes the same data boundary.
