# PE header and section range admission

`readPE` validates the complete DOS-pointer/PE/COFF/optional/section-header
extents before reading metadata. `SizeOfHeaders` must cover the actual section
table and cannot exceed the input file. Nonempty raw-file and effective virtual
section intervals cannot overlap the headers or another section. The effective
virtual size remains `max(VirtualSize, SizeOfRawData)`, matching the reader's
existing raw-padding addressability. The public section order is preserved.

The internal `pe/bounds.js` seam checks nonnegative safe integer ranges with
subtraction before addition. An exclusive range end may equal its limit,
including the exact `2^32` RVA endpoint. Two private interval indexes are sorted
once during admission: **O(n log n) time and O(n) auxiliary space**, with the
existing maximum of 96 sections. RVA queries retain the existing linear scan;
there is no interval sort or new array on the query path.

Empty raw intervals do not occupy file space. Their raw pointer still must be
within the file, preserving the existing empty-pointer bound. A virtual-only
section (BSS) participates in virtual overlap and overflow checks but does not
provide a file-backed RVA, even for a zero-length query. Completely empty
sections occupy neither interval space. Nonempty sections retain zero-length
endpoint queries, including the existing ambiguity rejection where two touching
sections both match. Positive-length queries require actual raw bytes.

New rejected layouts throw `CilError` with the file offset of the offending
header field. Bad RVA query arguments retain the `Invalid RVA range` diagnostic;
non-numeric arguments cannot escape through formatting a non-numeric offset.
Eager raw/virtual overlap rejection and the zero-raw RVA rule are deliberate
admission policies. Native PEReader acceptance is observed independently, not
assumed identical. No new alignment, sorted-section-table, section-adjacency,
`SizeOfImage`, certificate-directory or other unrelated policy is introduced.

PE classification, ILOnly/native admission, available CIL in ReadyToRun images,
optional-header fields, metadata parsing and method-body semantics are unchanged.
The metadata-options forwarding seam is maintained independently when that
qualified branch is integrated; this change does not replace its invocation.

The source policy was checked against Microsoft's official
[PE format specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format),
specifically MS-DOS Stub, Optional Header Windows-Specific Fields, Section Table
and Section Data, accessed 2026-10-04. The specification distinguishes raw file
data from virtual zero fill and permits raw size to exceed virtual size due to
padding. This implementation documents its conservative mapping extent and
does not claim to emulate the operating-system image loader.

Qualification source, exact planned commands, native acceptance distinctions and
performance protocol are in
[`tests/fixtures/pe-bounds`](../../tests/fixtures/pe-bounds/README.md).
No prepared test or observer is a completed qualification result.
