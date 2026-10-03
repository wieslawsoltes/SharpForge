# PE platform fixtures

`legacy-pe32.json` records the SHA-256 of the original default writer's output at
`9e40334955213d0c9960a5649c975d80ada64496`, using a fixed section/metadata range. It protects
byte identity for the four-argument low-level API while high-level executable emission
corrects IMAGE_FILE_DLL.

`oracle/prepare.js` creates AnyCPU, x86, x64 and ARM64 libraries/executables and desktop
CLR entry-stub images in a temporary directory. `oracle/Program.cs` reads them through
System.Reflection.PortableExecutable.PEReader, then loads matching-host modern .NET
images, checks `GetPEKind`, and executes entry points expecting `42\n`. Unsupported
host architectures are reported explicitly. Desktop-profile executables are run
separately under Mono where available; PEReader inspection alone is not execution proof.

`native.json` records the exact .NET runtime/host and per-image observations. Regenerate
sequentially with a validation slot; never invoke parallel build/test jobs:

```sh
node tests/fixtures/a03-pe/oracle/prepare.js /tmp/a03-pe-fixtures
dotnet build tests/fixtures/a03-pe/oracle/PEOracle.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-pe-obj/ -p:OutputPath=/tmp/a03-pe-bin/
dotnet /tmp/a03-pe-bin/PEOracle.dll /tmp/a03-pe-fixtures/*.dll /tmp/a03-pe-fixtures/*.exe > tests/fixtures/a03-pe/native.json
mono /tmp/a03-pe-fixtures/desktop-anycpu.exe
node --test --test-concurrency=1 tests/a03-03-*.test.js
```

The legacy fixture generator takes the old module path, destination JSON and source
commit as its three arguments. Do not generate it from the replacement writer.

`evidence.json` records the local gates, exact host and unavailable native targets. The serial
benchmark artifacts compare baseline `9e403349` with implementation `22ff9302`; run
`node --expose-gc tests/benchmarks/cil-pe.mjs [OLD_CIL_ENTRY_PATH]` for each side.
The generic layout/range checks and richer directory objects increase the median write
from 0.0657 to 0.0826 ms and read from 0.0894 to 0.1035 ms for a 64 KiB section.
Write p95 changes 0.1302 to 0.1581 ms; read p95 changes 0.2686 to 0.2318 ms.
Median heap deltas change 4,016 to 18,712 bytes (write), and 13,584 to 42,152 bytes (read).
Output size remains 66,560 bytes. The before/current read also includes the prerequisite
metadata reader changes. This is a disclosed feature/correctness cost, not a speedup claim.
