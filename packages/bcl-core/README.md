# BCL core

This package owns BCL family contracts and managed implementations. It has no
runtime or framework dependency. Hosts supply `bclHost.fault(type, message)`,
`bclHost.isReference(value)` and `bclHost.frameworkType(name)` on each platform.
The fault service must throw the host's managed exception.

Each family module has `name`, `families`, `contracts(registry)` and
`invoke(platform, descriptor, arguments)` members. Invocation returns
`{handled: true, value}` or `{handled: false}` synchronously. Module registration
is validated before publication, with a constant-time family lookup per call.
Registries are independent and immutable; managed state stays in the host heap.
`registry.invoke` and `invokeBclModules` accept an optional fourth argument with
the already resolved owner type. The registry passes it to the module's `invoke`
method; omitting it retains the host lookup, and `null` means an unknown type.

Add a module to `src/modules.js` to make it available to framework registration,
runtime dispatch and the generated inventory. The extracted release 13 and 14
modules use explicit registration groups to preserve every existing contract ID.
New modules use the `extensions` group in the reserved A07 range. Registering a
module through the framework remains transactional.

Run `node packages/bcl-core/scripts/inventory.js` to regenerate the documented
surface; `--check` compares the checked-in output. Public String, StringBuilder,
Array and Random metadata is pinned to .NET 10.0.5 and SDK 10.0.201, with native
extractor and source hashes. Exact signature presence is reported separately
from behavioral qualification; this extraction does not claim complete BCL parity.

`formatDoubleDefault(value)` formats a JavaScript binary64 number as invariant
.NET default text, including signed zero, shortest round-trip digits, uppercase
exponents padded to two digits, and the `NaN`/`Infinity` spellings. It is pure and
does not allocate managed memory. The shared numeric formatter also supports
`G`/`g` with the existing 0..99 precision limit and `R`/`r` for floating-point
values. The fifty-value .NET 10.0.5 fixture in `reference/double-format-net10.json`
qualifies binary64 default, general and round-trip output; it does not qualify
Single or Decimal formatting. Runtime display adapters reuse this helper while
retaining their engine-specific object, enum and typed integer handling.
