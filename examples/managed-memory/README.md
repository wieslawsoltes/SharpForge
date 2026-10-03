# Managed memory

This example combines frame-owned stack memory, Span slicing and rectangular
array indexing. Expected output is `12` twice. It is prepared for the E01 source,
reloaded-source and CIL qualification gate; no browser or native pass is claimed.

The native differential fixtures in `tests/fixtures/a05/memory-leaves` and
`tests/fixtures/a05/array-leaves` additionally exercise pinning, nullable boxing,
raw-bit reinterpretation, packed struct size, FieldRVA initializers and Array APIs.
