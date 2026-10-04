# Local annotation joins and display

Implementation-ready; no tests, native commands, installs or benchmarks have run
for this batch yet. Scheduled validation remains pending.

The focused tests reuse DynamicLocalVariables (`01`) and TupleElementNames
(`left\0right\0`) records captured from Roslyn 4.8.0-7.23558.1 and
5.3.0-2.26153.122 in [the existing corpus](../portable-pdb-interop/records.json).
That corpus records compiler/source/PDB hashes. The new tests join those bytes
onto authored PE/PDB local rows and assert the public bound scope display.
This is reuse of native codec evidence plus new offline integration, not a new
Roslyn compile, debugger session, or native end-to-end reference capture.

Other authored inputs cover per-occurrence dynamic flags despite shared
primitive nodes, nested tuples, long tuple rest chains, generic/array/byref
containers, object-null constants and a TypeSpec class-null constant containing
a tuple. The TypeSpec case is explicitly authored metadata, not a C# tuple
constant declaration. Negative cases cover framework-name lookalikes, mismatched
flags/name counts, parent references, duplicates and limits before expansion.
Unresolved enum TypeSpec annotations keep an explicit unsupported reason and the
existing unverified enum/scalar result, rather than attempting a missing type decode.
The public formatter hook is independently covered for unchanged fallback,
AST ownership, result validation and shared depth/node/cancellation budgets.

Primary rules used:

- [Portable PDB dynamic-local record](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md#dynamic-local-variables-c-compiler)
- [Roslyn dynamic transform traversal](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Symbols/Metadata/PE/DynamicTypeDecoder.cs)
- [Roslyn tuple name traversal](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Symbols/Metadata/PE/TupleTypeDecoder.cs)

No runtime values, generic substitution, external assembly resolution or broad
engine/platform qualification are claimed. Exact validation/performance evidence
will be recorded after the sole scheduled local slot.
