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
the remaining implementation in #2393, with qualification pending. It remains the
SharpForge document dialect and requires .image. New type/member/signature rows,
standalone ilasm syntax and Portable PDB rewriting remain separate capabilities.

Seven focused cases and a three-method native fixture are prepared. No local
native/test/check/benchmark run has occurred for this draft. The serial slot will
capture actual native results, run the focused/default compatibility cases and
required checks, and record paired default plus new-literal timings before readiness.
