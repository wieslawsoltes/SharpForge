"""Generate Unicode 16.0 grapheme ranges from three unmodified, licensed UCD files.

Usage: python generate-grapheme-data.py GraphemeBreakProperty.txt DerivedCoreProperties.txt emoji-data.txt
The generated format is sorted inclusive [start, end, packed-properties] triples.
Low four bits: GCB enum below; 0x10: Extended_Pictographic; 0x20/40/80: InCB C/L/E.
Hangul LV/LVT syllables are calculated by the runtime rather than stored as 798 ranges.
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if len(sys.argv) != 4:
    raise SystemExit('Expected GraphemeBreakProperty.txt, DerivedCoreProperties.txt and emoji-data.txt')
expected = json.loads((ROOT / 'reference/unicode-16.0.0/sources.json').read_text())['sources']
license_text = (ROOT / 'reference/unicode-16.0.0/LICENSE.txt').read_text().strip()
CLASSES = dict(Other=0, CR=1, LF=2, Control=3, Extend=4, ZWJ=5,
               Regional_Indicator=6, Prepend=7, SpacingMark=8, L=9, V=10, T=11, LV=12, LVT=13)
SOURCES = ['auxiliary/GraphemeBreakProperty.txt', 'DerivedCoreProperties.txt', 'emoji/emoji-data.txt']
values = bytearray(0x110000)
provenance = []
for position, argument in enumerate(sys.argv[1:]):
    data = pathlib.Path(argument).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected[position]['sha256']:
        raise ValueError('Input differs from the pinned Unicode 16.0 source: ' + argument)
    provenance.append(dict(url='https://www.unicode.org/Public/16.0.0/ucd/' + SOURCES[position],
                           sha256=hashlib.sha256(data).hexdigest(), bytes=len(data)))
    for raw in data.decode().splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(';')]
        if position == 0:
            if parts[1] in ('LV', 'LVT'):
                continue
            flag = CLASSES[parts[1]]
        elif position == 1:
            if parts[1] != 'InCB':
                continue
            flag = dict(Consonant=0x20, Linker=0x40, Extend=0x80)[parts[2]]
        else:
            if parts[1] != 'Extended_Pictographic':
                continue
            flag = 0x10
        bounds = parts[0].split('..')
        start, end = int(bounds[0], 16), int(bounds[-1], 16)
        for code in range(start, end + 1):
            values[code] |= flag
ranges = []
start = 0
for end in range(1, len(values) + 1):
    if end == len(values) or values[end] != values[start]:
        if values[start]:
            ranges.append((start, end - 1, values[start]))
        start = end
for page in range((len(ranges) + 399) // 400):
    rows = ranges[page * 400:(page + 1) * 400]
    lines = ['/*!', license_text, '*/',
             '// Generated Unicode 16.0.0 data. See reference/unicode-16.0.0 and scripts/generate-grapheme-data.py.',
             '// Inclusive start, inclusive end, packed GCB/Extended_Pictographic/InCB properties.',
             'export const ranges = new Uint32Array([']
    lines.extend(f'  0x{start:X}, 0x{end:X}, 0x{flag:X},' for start, end, flag in rows)
    lines.append(']);\n')
    (ROOT / 'src/grapheme' / f'ranges-{page}.generated.js').write_text('\n'.join(lines))
(ROOT / 'reference/unicode-16.0.0/sources.json').write_text(json.dumps(dict(
    unicodeVersion='16.0.0', rangeCount=len(ranges), sources=provenance), indent=2) + '\n')
print(json.dumps(dict(rangeCount=len(ranges), pages=(len(ranges) + 399) // 400)))
