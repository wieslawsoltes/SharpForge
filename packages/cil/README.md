# @sharpforge/cil

Genuine ECMA-335 PE/CLI emission, typed CIL lowering, bounded metadata/IL loading, canonical-profile verification and disassembly. JavaScript ESM. Version 0.6.0. MIT. Only sibling dependency: `@sharpforge/bytecode`.

```js
import { emitAssembly, loadAssembly, formatAssembly } from '@sharpforge/cil';

// image is the successful internal output of @sharpforge/compiler.compile().
const dll = emitAssembly(image, { framework: 'net8', embedSources: true });
const executable = loadAssembly(dll); // load once, reuse with VirtualMachine
console.log(formatAssembly(dll));
```

`emitAssemblyDetailed(image, options)` additionally exposes emission metrics and debug mappings. `compileToIL()` in the compiler package combines frontend and backend. The runtime and debugger accept DLL byte arrays or a reused decoded module.

The DLL contains real metadata/signatures, CIL method bodies and exception tables—not embedded VM code. An additional `#SF` stream holds source/local mappings and IL-span boundaries. `embedSources:false` removes source text; `includeDebug:false` strips this stream; the canonical source loader cannot load it, but supported methods can run in the separate direct-CIL interpreter.

The browser loader supports the exact emitted `SharpForge.CIL/1` profile. It checks canonical re-emission and rejects arbitrary external/noncanonical DLLs; it is not a general CLR loader or audited sandbox. PE32 emission; PE32/PE32+ header reading; default net8 and alternative mscorlib4 reference identities. No full C# semantics, Portable PDBs, strong names, native/JIT code or full .NET BCL.

The root source release includes the complete backend contract, public API examples, measurements, regression suite, independent .NET execution test harness and compatibility boundaries. The packages are local tarballs, not registry-published.

0.6 emits actual checked arithmetic/conversion instructions and InterfaceImpl metadata for concrete IDisposable resources, alongside finally cleanup. The canonical loader reconstructs and verifies these supported forms.
