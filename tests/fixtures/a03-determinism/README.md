# Deterministic content identifier reference

The small oracle pins System.Reflection.Metadata.BlobContentId.FromHash against .NET SHA256 for empty, UTF-8 and
all-byte-value inputs. It verifies content GUID byte order, UUID version/variant bits and the timestamp's high bit.
PE checksum tests use a separate BigInt one's-complement reference, including odd overlays and header offsets.

Run sequentially only during the granted local validation slot:

```sh
dotnet build tests/fixtures/a03-determinism/oracle/ContentId.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-content-id-obj/ -p:OutputPath=/tmp/a03-content-id-bin/
dotnet /tmp/a03-content-id-bin/ContentId.dll > tests/fixtures/a03-determinism/srm.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-03-determinism.test.js
```

The complete browser/native matrix remains the completed epic's qualification gate; this fixture does not claim it.

For the serial before/current benchmark, use the existing driver with the prior CIL API path, then with the local
static adapter (which enables deterministic finalization):

```sh
node --expose-gc tests/benchmarks/cil-pe.mjs /absolute/path/to/prior/packages/cil/src/index.js
node --expose-gc tests/benchmarks/cil-pe.mjs ./cil-deterministic-api.mjs
```

Both measurements use the same 64 KiB section and metadata input. The current measurement includes full-content
hashing, MVID/timestamp patching and PE checksum work; the baseline measures the preceding emitter behavior.

Validation on 2026-10-03: .NET SDK 10.0.201/runtime 10.0.5 matched all three cases.
The six-file focused PE/PDB run passed 73/73 tests; `npm run check` passed 1632 syntax
modules and 1628 static modules with zero errors. `check:structure` reported 258 existing
repository findings and none in this batch's changed files. No full matrix was run.

Benchmark baseline: `codex/a03-shared-sha256` at `5b2420826f02ee2d9a4699f6ed0c9d2e07317eb1`;
current implementation: `c7742370` with deterministic adapter. Apple M3 Pro, macOS ARM64,
Node 24.21.0; 30 samples with explicit GC, local runs serial (other agents could edit and
remote CI could run). Raw measurements are adjacent JSON files. Write median/p95 increased
from 0.1304/0.4358 ms to 1.5971/2.4374 ms; read median/p95 was 0.1389/0.4015 ms before
and 0.1172/0.6165 ms after. Write median heap delta was 18,808 → 395,072 bytes; read was
42,200 → 45,768. Output remained 66,560 bytes. This is a feature cost, not a speedup:
the new path hashes the entire PE, parses/patches its identity and computes a checksum.
