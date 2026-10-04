# Real font atlas residency

`glyph-atlas-residency-5000` uses the pinned HarfBuzz Wasm and licensed SharpForge
Sans variable fixture. It shapes printable ASCII across at most 64 real weight-axis
instances, then selects 5000 distinct nonempty `(fontId, glyphId, fontSize)` pairs.
These are actual font/glyph instances, not 5000 different Unicode characters. Every glyph ID
comes from HarfBuzz, and its face, variation axes, outline and bounds remain real.
An explicit 100-column stress grid is separate from the normal text layout fixtures.

The retained workload is 2400×1400 DIP, DPR 1, with 16 DIP glyphs. The browser check
requires 5000 numeric GPU instances and 5000 valid atlas entries within the existing
32 MiB atlas budget. Five unchanged frames must preserve the same compiled plan
and entry identities. Additional bounded plans rasterize real larger glyphs until
a page containing original entries is recycled. Empty frames and completed queue
submissions release live plan pins; the test never changes atlas internals to force
an eviction. At most 16 pressure passes, 512 glyphs per pass, are admitted.

After actual recycling, the original 5000 glyph display list is rendered again.
All glyph entries and instances must be present, and its premultiplied GPU readback
must match the original bytes exactly. Intermediate pressure frames exist only to
exercise cache lifetime. The final image is also compared with a separate Canvas2D
rendering of the same pinned numeric outlines. That comparison uses the declared
edge tolerance; the GPU before/after comparison permits no changed byte.

The report records font hashes, distinct font instances, glyph count, peak/final
atlas bytes, page generations, evicted entries, recovery and unchanged-frame evidence.
A Canvas-only run reports that GPU residency requires WebGPU. It never supplies
an invented adapter, passes a missing-entry check by rasterizing that entry itself,
or substitutes whole-run text tiles for numeric glyph instances.

No browser or native evidence is implied by authoring these files. Run this fixture
through the shared completed-scope browser runner after the full qualification scope
is implemented. Software adapters retain their software tier; physical hardware and
native WinUI typography comparisons require their separate recorded environments.
