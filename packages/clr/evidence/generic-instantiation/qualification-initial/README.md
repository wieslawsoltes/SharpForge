# Initial generic-instantiation qualification evidence

This is the immutable record before the finite-instantiation-closure correction.
It intentionally preserves failures and does not claim the product qualified.
Root ran the jobs serially through the scheduled limiter; the authoring agent
performed no additional execution when retaining these files.

| Revision and job | UTC interval on 2026-10-04 | Actual result |
| --- | --- | --- |
| 2042ca6b native-first | 17:24:19.815–17:24:22.476 | SDK/compiler stages passed; observer failed before JSON while eagerly loading the Node definition |
| f551d51c revised native-first | 17:47:29.253–17:47:32.421 | Six commands passed; 101 main cases, 7 lifetime cases, 6 images, 8 source pins and 167 reference assembly hashes verified |
| f551d51c exact 21-file Node gate | 17:50:58.816–17:51:07.987 | 84 tests, 82 passed, 2 failed, 0 skipped |

The unchanged Node fixture has an expanding recursive generic inheritance
dependency. CoreCLR 10.0.5 rejects its definition and all four dependent Node
operations with `System.TypeLoadException`, HRESULT `-2146233054`. Twelve
identity pairs were observed; two Node pairs have explicitly unavailable
endpoints. Their `same: null` entries make no equality assertion.

The first product failure is `Missing expected rejection: definition-node`.
The other failure is an obsolete assertion in `clr-types-graphs.test.js` that
expects unsupported generic services. Generic resolution now reaches the
unconfigured `IList` assembly reference and reports `SFCLR002 MissingAssembly`.
Both raw failures remain in [focused.tap](f551d51c/focused.tap); neither is
converted into a skip or a passing observation.

The successful native files are stored once in the
[reference fixture directory](../../../../../tests/fixtures/clr-generic-instantiation/README.md).
Their retention receipt and original raw stdout/stderr are preserved. The
failed 2042 native files are retained separately under `2042ca6b/native-first`.
Plans, source-pin overlays, preparation scripts, recorders and the retainer are
retained without rewriting their original absolute paths or execution results.

[retention-manifest.json](retention-manifest.json) maps original paths to the
retained bytes and SHA-256 values. Original candidate and baseline source trees
are identified by the captured pins and Git objects rather than duplicated.
The complete Git tree listing is likewise retained by its byte count and hash;
its original raw file remains in the external qualification workspace.

Key evidence hashes:

- Native JSON: `6355984f532dedd348654c59c97388a4eedde65e63fcea4a120e5e96de7789e3`.
- Native retention receipt: `7aee630178d633a1ccafcf0d9e28f8aea48dd909bfe554097712e8d192a00af2`.
- Failed Node TAP: `3578c6ab9210295b0bdd2aee67fcc317a2b47f6bce18cf4ca8cca80e003c01c8`.

CLR source remained `7054ca7157a723e09fef8e5df3b468925b8faad5` and CIL source
remained `8f1711276d10bcaa62cc711ff9d070a97e056993` throughout these jobs.
No benchmark was run. The original seven control and eight service workloads
and all source/input pins remain unchanged; their read-only Node usage audit
is included under `protocol/`.
