# @sharpforge/winui-properties

Application-owned UI services for SharpForge. Instances have explicit lifetimes; the package has no external runtime dependencies or import-time registrations.

## UI member adapters

`UIExtensionRegistry` registers constructor, method and property handlers by owner and signature. The injected context owns platform conversion and task handling.

## Dependency property registration

`DependencyPropertyRegistry` allocates immutable identities per owner and validates defaults before publishing them. Attached properties retain their declaring owner; inherited lookups reuse that identity. `PropertyMetadata` supplies callbacks, factory defaults and validation policy to the consuming host. Registry snapshots retain token identity and reject cross-registry tokens.

## Binding definitions and paths

`Binding` retains explicit source, mode, conversion and fallback configuration. An absent source or fallback uses `UnsetValue`, while an explicit null remains a value. `RelativeSource` and definition snapshots preserve the selected source policy without invoking application code. `PropertyPath` stores immutable path text; `parsePropertyPath` produces bounded, frozen member/indexer/attached-property steps with positional syntax failures. The parser defaults to 4,096 characters and 128 segments.

The executable binding engine and managed adapters consume these definitions in later batches.

## Property ABI provider

registerPropertyContracts accepts an explicit reserved framework registry. It appends typed metadata and dependency property callbacks, Binding/RelativeSource/converter contracts, observable notifications, vector/list interfaces and inheritable text/attached identifiers without redefining released members. Importing this provider does not register it in the default framework registry.
