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

Add a module to `src/modules.js` to make it available to framework registration,
runtime dispatch and the generated inventory. The extracted release 13 and 14
modules use explicit registration groups to preserve every existing contract ID.
New modules use the `extensions` group in the reserved A07 range. Registering a
module through the framework remains transactional.

Run `node packages/bcl-core/scripts/inventory.js` to regenerate the documented
surface; `--check` compares the checked-in output. The reference is the released
SharpForge ABI, not a claim of complete .NET BCL parity. Later work adds the
versioned .NET inventory and capabilities independently of this extraction.
