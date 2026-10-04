# Pinned grapheme data: Unicode 16.0.0

The default grapheme segmenter and the streaming visual-column index implement extended grapheme boundaries from [UAX #29 revision 45](https://www.unicode.org/reports/tr29/tr29-45.html). Pinning one profile keeps keyboard navigation, box editing, layout and asynchronous status columns consistent when browsers ship different ICU versions. Callers that explicitly need host-tailored segmentation can still inject an `Intl.Segmenter` into `GraphemeSegmenter`.

The data is covered by the accompanying [Unicode license](LICENSE.txt). Each generated source page also retains the complete license in a `/*! ... */` header so package and bundled copies carry the notice. `sources.json` records the unmodified source URLs, byte sizes and SHA-256 hashes. The complete official conformance fixture is retained at `tests/fixtures/unicode-16.0.0/GraphemeBreakTest.txt`, with its original copyright and provenance headers.

## Generated format

`src/grapheme/ranges-0.generated.js` and `ranges-1.generated.js` contain 683 sorted, disjoint inclusive ranges. Each row is a numeric `[start, end, properties]` triple in a flat `Uint32Array`. Pages contain at most 400 rows, so no generated source file exceeds the normal source-size limit.

The low four bits encode Grapheme_Cluster_Break: Other=0, CR=1, LF=2, Control=3, Extend=4, ZWJ=5, Regional_Indicator=6, Prepend=7, SpacingMark=8, L=9, V=10, T=11, LV=12, LVT=13. Bit `0x10` marks Extended_Pictographic. Bits `0x20`, `0x40` and `0x80` encode Indic_Conjunct_Break Consonant, Linker and Extend. Unlisted code points have the default Other value. Hangul LV/LVT syllables use the standard arithmetic rule instead of 798 repetitive ranges.

Regenerate the exact tables after downloading the three URLs from `sources.json`:

```sh
python packages/text/scripts/generate-grapheme-data.py \
  GraphemeBreakProperty.txt DerivedCoreProperties.txt emoji-data.txt
```

This generator has no runtime or package dependencies. It reads supplied files and emits only the two data pages and provenance JSON. Version upgrades must update the source URLs, documented profile, generated data and official fixture together, then pass the conformance and editor compatibility suites.

## Streaming rule state

`GraphemeState` retains the previous break class, regional-indicator parity, the extended-pictographic/ZWJ context and the three-state Indic conjunct context. It implements GB3–GB9c, GB11–GB13 and the default boundary rule. The state has constant size even for arbitrarily long combining or ZWJ clusters. The visual-column accumulator independently retains the current cluster's base width and emoji-presentation flag; it never retains the cluster text.

The default previously used host `Intl.Segmenter`, with an approximate fallback. Existing documented fixtures are retained, and a separate reference test compares all Unicode 16.0 conformance rows against an actual Unicode 16.0 host `Intl.Segmenter`. Host comparisons explicitly skip when the runtime uses another Unicode version; the pinned official fixture always runs.
