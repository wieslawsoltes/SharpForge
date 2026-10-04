# @sharpforge/bytecode

Versioned typed-array instructions, metadata, verifier, serializer and disassembler.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/bytecode';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## Builtin metadata

`builtinOwners`, `builtinMemberShape(builtin)` and `builtinParameterType(builtin, type)` expose the same core intrinsic owner and parameter rules used by the compiler. Pass descriptors from `Builtins` or `BuiltinMap`; the functions project metadata without modifying descriptors, stable numeric IDs, receiver-inclusive runtime parameter lists or execution behavior. `builtinMemberShape` returns `{name, instance, property}`. Core builtin entries whose names begin with `$` are internal and should not be shown as source API members. Framework contracts continue to use their registered owner and signature metadata.
