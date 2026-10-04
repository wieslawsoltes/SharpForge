"""Reproduce the bounded OFL text fixtures from the pinned upstream font files.

Usage: python subset-font-fixtures.py SOURCE_DIRECTORY OUTPUT_DIRECTORY
fontTools is a development-only fixture tool; its version is recorded in provenance.
The modified fonts use new family names and retain their copyright/license records.
"""

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


LATIN_RANGES = [(0, 0x250), (0x300, 0x530), (0x1E00, 0x1F00),
                (0x2000, 0x2070), (0x20A0, 0x20D0), (0x2100, 0x2150), (0x25A0, 0x2600)]
EMOJI = '😀🙂❤️👩‍💻👨‍👩‍👧‍👦🏳️‍🌈👩🏽‍🚀👍🏽🇺🇸🇵🇱☕✈️'


def rename(font, family, style):
    names = {1: family, 2: style, 3: family + '-' + style, 4: family + ' ' + style,
             6: family.replace(' ', '') + '-' + style, 16: family, 17: style}
    table = font['name']
    for record in table.names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())


def write_subset(source, target, spec):
    input_name, output_name, family, style, unicodes = spec
    font = TTFont(source / input_name, recalcTimestamp=False)
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.recalc_timestamp = False
    options.notdef_glyph = True
    options.notdef_outline = True
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=unicodes)
    worker.subset(font)
    rename(font, family, style)
    font.save(target / output_name, reorderTables=True)


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Expected source and output directories')
    source, target = (Path(value).resolve() for value in sys.argv[1:])
    target.mkdir(parents=True, exist_ok=True)
    latin = sorted({value for start, end in LATIN_RANGES for value in range(start, end)} | {0xFEFF, 0xFFFD})
    emoji = sorted({ord(value) for value in EMOJI})
    specs = [
        ('NotoSans-Variable.ttf', 'SharpForgeSans-Variable.ttf', 'SharpForge Sans Fixture', 'Regular', latin),
        ('NotoSans-Italic-Variable.ttf', 'SharpForgeSans-Italic-Variable.ttf', 'SharpForge Sans Fixture', 'Italic', latin),
        ('NotoColorEmoji-CBDT.ttf', 'SharpForgeEmojiFixture.ttf', 'SharpForge Emoji Fixture', 'Regular', emoji)
    ]
    for spec in specs:
        write_subset(source, target, spec)


if __name__ == '__main__':
    main()
