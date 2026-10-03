# @sharpforge/bytecode

Versioned typed-array instructions, metadata, verifier, serializer and disassembler.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/bytecode';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

`createBuiltinRegistry(base = Builtins)` appends validated builtin contributions
without changing existing slot identities. Sparse array reservations remain
holes, including in the frozen `entries` snapshots; new IDs start at the base
array's length. Non-array iterable bases remain supported. Rejected or cancelled
contributions leave the registry unchanged.
