# New strings in editable IL documents

`assembleILDocument` accepts a JSON-quoted operand on `ldstr`, for example:

```text
IL_0000: ldstr "new text https://example.test/a//b\nnext line"
```

JSON escapes represent quotes, backslashes, control characters and UTF-16 code
units. A trailing `//` comment is recognized outside the quoted literal only.
Other token operands remain numeric references to the scaffold's existing metadata.
The formatter retains its numeric-token output contract.

Quoted literals append entries to the existing #US bytes and deduplicate newly
added values across methods. Existing #US offsets stay valid. The shared
MetadataHeaps encoder supplies the CLI UTF-16 payload and special-character flag.
An absent #US heap is added when the metadata stream count permits it. The image
writer appends a new metadata root, preserving other streams and metadata rows
except the method RVAs that the existing assembler already rewrites. Its current
signature/custom-debug-map invalidation remains in effect. Numeric-only documents
keep their previous metadata-root location and require no heap rebuild.

`maxUserStringBytes` can lower the final appended heap limit from 16 MiB down to
zero. Zero disables new literals while allowing existing numeric tokens. The limit
is checked before JSON decoding, before copying the old heap and before encoding
a new entry. At most 100000 distinct literals are added. Metadata is bounded to
32 streams and 64 MiB; its stream directory is preflighted before writing directly
into the image buffer, without another whole-root copy. Invalid literals/options
and exceeded limits produce CilError. Work is linear in input/literal/stream bytes
plus the separately documented optional branch layout.

Use `{ relaxBranches: true }` to combine a new literal with edited long loops; the
same branch/EH relocation API from IL-DOCUMENT-LAYOUT.md is reused. This completes
the remaining implementation and acceptance criterion in #2393. It remains the
SharpForge document dialect and requires .image. New type/member/signature rows,
standalone ilasm syntax and Portable PDB rewriting remain separate capabilities.

Validation: the native fixture passes all three methods on .NET 10.0.5 (SDK
10.0.201); Main executes the edited long loop and returns the new literal, Original
retains the old numeric token and Again returns the same addition. Seven focused
cases plus existing document-layout/managed-IL compatibility pass 68/68, including
direct CIL and the expected source-profile invalidation. Static checks pass with
2618 syntax modules and 2614 static modules. The structure check reports 268
pre-existing findings, none in the changed files. Broader browser/Rust/platform
qualification remains staged for the epic; those engines are not claimed here.

Paired default timings restore both changed pre-existing product modules from
parent 7bd1239a and use the same candidate harness. On Apple M3 Pro / macOS ARM64,
Node 24.21.0, two warmups and seven chronological observations per case gave:

| Case | Parent median / p95 ms | Candidate median / p95 ms |
|---|---:|---:|
| 1000 default NOPs | 1.829416 / 1.997250 | 1.788833 / 2.028333 |
| 5000 default NOPs | 5.032792 / 5.825917 | 4.889000 / 5.095625 |
| 1000 unique new strings | — | 5.287792 / 6.269791 |
| 5000 unique new strings | — | 18.429916 / 21.884542 |

Default output sizes remain 3072 and 11264 bytes. New-string outputs are 38400
and 194560 bytes and perform additional string/metadata work, so they are not
paired default-performance comparisons. Median heapUsed deltas are recorded in
[the raw report](benchmarks/il-document-strings.json), together with every sample,
exact sources and command. These deltas are not allocation totals, peak memory or
RSS. This was the sole scheduled team validation job on a shared host; no
statistical-significance, speedup or general memory-reduction claim is made.
