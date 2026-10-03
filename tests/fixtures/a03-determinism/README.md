# Deterministic content identifier reference

The small oracle pins System.Reflection.Metadata.BlobContentId.FromHash against .NET SHA256 for empty, UTF-8 and
all-byte-value inputs. It verifies content GUID byte order, UUID version/variant bits and the timestamp's high bit.
PE checksum tests use a separate BigInt one's-complement reference, including odd overlays and header offsets.

Run sequentially only during the granted local validation slot:

```sh
dotnet build tests/fixtures/a03-determinism/oracle/ContentId.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-content-id-obj/ -p:OutputPath=/tmp/a03-content-id-bin/
dotnet /tmp/a03-content-id-bin/ContentId.dll > tests/fixtures/a03-determinism/srm.json
node --test --test-concurrency=1 tests/a03-03-determinism.test.js
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
