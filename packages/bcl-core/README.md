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

StringBuilder reports the .NET default `MaxCapacity` of `Int32.MaxValue`
(`2147483647`) in both metadata and execution. The host separately limits text
and requested capacity to 1,000,000 UTF-16 code units. Exceeding that allocation
budget raises `OutOfMemoryException`; negative capacities and capacities below
the current length raise `ArgumentOutOfRangeException`. The host budget is not
a claim that allocations up to .NET's maximum can be satisfied. Constructor
defaults are captured in `reference/builder-format/oracle.json` against the
pinned .NET toolchain, and source/direct CIL regression tests consume the capture.
