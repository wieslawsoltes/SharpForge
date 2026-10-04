# Default JSON escaping reference

`Program.cs` captures System.Text.Json's default string encoding on the pinned
.NET 10.0.5 runtime, reference pack 10.0.5 and SDK 10.0.201. Run the explicit
`node tests/fixtures/json-escaping/capture.mjs` command only in the serial native
validation queue. It compiles and executes once; normal tests read `oracle.json`.

Inputs retain their UTF-16 code units so invalid surrogate cases survive JSON
transport. Expected output includes scalar values, array values and dictionary
keys. Large escaped strings use exact lengths and SHA-256 summaries to bound
capture output. The runtime's one-million-unit JSON output budget is a host
limit, separate from native escaping behavior. Numeric formatting and custom
encoder options are outside this fixture's scope.
