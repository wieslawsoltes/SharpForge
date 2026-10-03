# Static initialization reference fixture

`Program.cs` covers three mutually referencing precise type initializers,
a failing initializer accessed twice, its `InnerException`, and lazy field
initialization for a `beforefieldinit` type.

Expected output for the runtime's permitted lazy beforefieldinit policy:

```text
A
B
C
3
2
1
Broken
cause
cause
Ping
before field
Lazy
9
```

During full E04 qualification, compile with the installed Roslyn SDK and run
the same assembly with native .NET and `CilVirtualMachine`. The first nine lines
are strict initializer-order/failure requirements. ECMA-335 permits earlier
execution for `beforefieldinit` types, so native Lazy placement is recorded as
an implementation observation; the VM deliberately initializes on field access.
The independent scheduler-context tests additionally cover contention and
initialization wait cycles, without claiming native OS-thread equivalence.

Reproducible differential runner (execute after full E04 implementation):

```sh
DOTNET_PATH=/path/to/dotnet node scripts/validate-a05-static-init.js
```

It emits the DLL, runtime configuration, tool versions, source/assembly hashes,
and both outputs under `artifacts/a05-static-init/`. This runner deliberately
requires the observed native lazy order for this fixture, while the runtime's
policy remains one of the orders allowed by ECMA-335.

The reusable E04 runner accepts source files or directories with `expected.txt`:

```sh
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05-static-init
node scripts/validate-a05-type-system.js --fixture /path/Program.cs --expected /path/output.txt
```

Repeat `--fixture` to compare multiple programs, pair each optional `--expected`
with its preceding fixture, and use `--output` to select the artifact directory.
With no fixture arguments, the runner includes this fixture, generic statics,
enums/strings, type tokens, and the native assignability oracle. The latter
compares native `Type.IsAssignableFrom` with the shared `CastCache`; its report
explicitly distinguishes that algorithm comparison from same-DLL CIL execution.
`--casts` selects only that oracle. `DOTNET_PATH` and `DOTNET_TARGET_FRAMEWORK`
select the SDK executable and target framework. Run only after E04 is assembled.

The runner compiles fixture `.cs` files in Release with no NuGet feeds; it does
not consume custom project files or dependencies. It retains source, expected
output, DLL, runtime configuration, source/assembly hashes, tool versions, and
both results. CRLF is normalized to LF; other output differences fail. Failed
cases produce evidence and do not prevent remaining cases from being compared.
