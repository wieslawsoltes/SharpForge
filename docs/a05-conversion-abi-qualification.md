# Conversion qualification across native integer widths

Issue [#1349](https://github.com/wieslawsoltes/SharpForge/issues/1349) retains its
original wording: “15 targets x 5 source kinds”. Its deliverable lists 13 CLI
conversion forms. ECMA-335 III.3.27–29 enumerate 13 ordinary opcodes plus ten
checked and ten checked unsigned-source opcodes. The unchanged matrix covers
all 33 opcodes for each of `i4`, `i8`, `r4`, `r8`, and `native`.

The historical generator already distinguishes 13 target encodings from 15
concrete columns across ABIs: eleven non-native forms plus `i@32`, `u@32`,
`i@64`, and `u@64`. This is a stronger coverage interpretation, not a claim
about the issue author's intent or permission to rewrite its acceptance text.
No aliases or extra opcode encodings are added. Both native configurations
matter to source-kind interpretation as well as target bounds.

`scripts/numeric/qualify-conversions.js` captures only this existing matrix with
the requested .NET 10 SDK. It copies the unchanged `ConversionOracle.cs`, whose
DynamicMethod emits each actual opcode. The independent runtime probe uses the
same dotnet executable, runtimeconfig, working directory and environment as the
oracle. It must observe IntPtr.Size four and process architecture X86 for ABI32
before operands are generated. The Node host's architecture does not qualify
the guest width.

The ABI32 matrix has 2,277 cases; the retained ABI64 matrix has 2,112. Every
answer or OverflowException is compared through source, source reloaded from
the emitted assembly, and direct CIL using the existing differential helper.
Chunks of 48 preserve every operand while bounding compilation size. Their
exact source, emitted assembly, expected output, route counts and instruction
counts remain in the output directory. Each compiled chunk retains and hashes
its emitted assembly before any VM executes. A failing replay therefore keeps
the exact CIL, source, native answers and error; only completed chunks claim
successful route evidence. A compilation failure has no emitted assembly to
retain. The historical ABI64 corpus and its hashes are untouched; the
100,000-pair Int64 program is not run by this command.

The existing Windows x86 workflow adds this capture/replay only to the .NET 10
cell. SDK8 remains unsuitable for the pinned saturation policy; its existing
native-width fixture still runs independently. Full stdout/stderr and raw exit
statuses, SDK/runtime probe, projects, assemblies, input cases, native answers,
resource variables, source revision/tree and artifact hashes are uploaded.
An always-run finalizer rechecks raw hashes and route completeness and reports
missing or partial qualification as failure. Existing output is never overwritten.
The SDK selector created by the installer is explicitly recorded; any other
source dirt or a changed product identity rejects qualification.

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
  node scripts/limited.js node scripts/numeric/qualify-conversions.js \
  --native-bits 32 --sdk 10.0.201 --dotnet /path/to/x86/dotnet \
  --output artifacts/a05-native-width/conversions
```

The new exhaustive ABI32 qualification remains **pending actual hosted execution**.
Authored machinery or configured VM-width tests do not establish native parity.
No issue closure or whole-platform qualification follows from this addition.
Unsupported engines and other unmeasured lanes remain explicitly unqualified.

Primary references: [ECMA-335, sixth edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf)
and [Microsoft's .NET 9 floating-to-integer policy](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer).
The latter distinguishes the pinned .NET 9/10 small-integer narrowing behavior
from the later .NET 11 direct small-integer saturation change.
