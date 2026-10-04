# @sharpforge/winui-properties

Dependency properties, bindings, resources and templates with explicit application lifetimes.

This package contains framework-independent services. Hosts supply their type registry,
managed values, scheduling, rendering and permission services explicitly. Import public
APIs from `@sharpforge/winui-properties`; implementation paths are not public contracts.

Instances belong to an application or rendering session and must be disposed with it.
Focused API and scope documentation lives beside each service group in `docs/`.

Project 14 additions are allocated from the existing area contract reservations. Released
framework contract identifiers and signatures retain their original meanings.

## Style compatibility

Native styles created with `Style(System.Type)` seal after successful application,
including their setters and BasedOn chain. The released `Style(string)` constructor
retains its mutable definition profile. A setter edit in that profile updates only
subscribed consumer layers and preserves any local, binding or animation override.
Removing an animation reveals the current style value. Definition changes preflight
all consumers and roll back together on failure; a mutation is limited to 1024
consumer layers. Applying a typed style also seals any shared legacy BasedOn chain.

`Control.DefaultStyleKey` selects a resource key for the default-style source layer.
Typed keys use the canonical managed type identity; JavaScript framework constructors
represent the same keys. A missing typed resource falls back to the registered recipe
for that type or its base. String and object keys select only their named resource.
An unset or cleared key retains the control family's recipe, while an explicit `null`
removes that default layer. Explicit styles and local values retain their stronger
precedence. Key changes, dictionary replacements and theme changes validate before
applying; each control releases its key observer on disposal and restores it without
replaying factories during rewind. `StyleApplication.setDefaultStyleResource(key,
fallback)` exposes this same incremental mechanism to injected hosts.

The native type-key intent is documented in Microsoft's
[DefaultStyleKey reference](https://learn.microsoft.com/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.control.defaultstylekey).
Named string/object resource keys are the bounded SharpForge resource profile.

## Property and binding APIs

- [Property stores, notifications, binding services and host contracts](docs/property.md)
- [Compiled binding descriptor schema, metadata compiler and lifetime contracts](docs/compiled-binding.md)
- [A15 issue coverage and qualification inventory](docs/property-acceptance.md)
- [Runnable property/binding example](examples/property-binding.mjs)
