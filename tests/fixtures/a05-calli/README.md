# Managed `calli` reference fixture

`Program.cs`, `Calli.csproj`, and `expected.txt` are copied unchanged from the
retained assembled E01 tree at
`4fa8e838cdce3322007b25d10e1dcfbe31823455`. The program's originating commit is
`dbac611d48bb30e16d74bb715d4c599aa24cfcfe`
(`fix(cil): preserve nested function-pointer call provenance`).

The project targets .NET 10 with optimization and unsafe code enabled. It covers
a managed pointer local, an argument, a static field, and a pointer-returning
factory invoked indirectly. Compile and execute the same DLL with the native
runtime and direct CIL engine when its serial qualification slot is available;
both outputs must equal `expected.txt`.

This extraction has not run the compiler, native runtime, or direct CIL fixture.
The expected output is retained reference material, not fresh validation evidence.
