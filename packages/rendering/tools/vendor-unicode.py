"""Reproduce the pinned Unicode assets from local, verified upstream checkouts.

No network or source execution: copy notices and mechanically adapt module syntax,
inflate the upstream generated tries, and compact the Unicode property ranges.
"""
import argparse
import base64
import gzip
import hashlib
import json
import re
import shutil
import struct
from pathlib import Path


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def module_syntax(text):
    text = re.sub(r"import (DATA|data) from ('[^']+')", lambda match: "import {DATA as " + match[1] + "} from " + match[2], text)
    text = re.sub(r"export default", "export const DATA =", text)
    text = re.sub(r"((?:import|export)[^;]*? from ['\"][^'\"]+['\"])(?!;)", r"\1;", text)
    text = re.sub(r"(export\s*\{[^}]+\})(?!\s*from)(?!;)", r"\1;", text)
    return text


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_bidi(source, target):
    shutil.copyfile(source / "LICENSE.txt", target / "LICENSE.txt")
    for path in (source / "src").rglob("*.js"):
        text = module_syntax(path.read_text())
        if path.name == "reordering.js":
            text = text.replace("lineLevels[i] = paragraph.level", "lineLevels[i - lineStart] = paragraph.level")
        write(target / path.relative_to(source), text)


def trie_module(source, name):
    text = (source / "lib" / (name + ".js")).read_text()
    encoded = re.search(r"UnicodeTrie.fromBase64\(\s*`([^`]+)`", text).group(1)
    binary = base64.b64decode(encoded)
    high_start, error, version, length = struct.unpack_from("<4I", binary)
    if version != 0xFFFFFFFF:
        raise ValueError("Unexpected upstream Unicode trie format")
    raw = gzip.decompress(binary[16:16 + length])
    values = json.loads(gzip.decompress(binary[16 + length:]))
    data = struct.unpack("<" + "i" * (len(raw) // 4), raw)
    rows = [", ".join(map(str, data[start:start + 24])) for start in range(0, len(data), 24)]
    return "\n".join([
        "// Derived from the pinned upstream Unicode17 trie. See provenance.json.",
        "import {UnicodeTrie} from './trie/index.js';",
        "export const version = '17.0.0';",
        "export const values = Object.freeze(" + json.dumps(values) + ");",
        "export const names = Object.freeze(Object.fromEntries(values.map((name, index) => [name, index])));",
        "const data = new Int32Array([\n  " + ",\n  ".join(rows) + "\n]);",
        "export const " + name + " = new UnicodeTrie({data, highStart: " + str(high_start)
        + ", errorValue: " + str(error) + ", values});", ""
    ])


def copy_linebreak(source, trie_source, target):
    shutil.copyfile(source / "LICENSE", target / "LICENSE")
    for name in ["index.js", "state.js", "break.js"]:
        text = (source / "lib" / name).read_text()
        if name == "index.js":
            text = text.replace("new BreakerState(str)", "new BreakerState(str, this.#opts.work)")
            text = "import {unicodeCategory, unicodeExtendedPictographic} from '../../src/text/unicode-properties.js';\n" + text
            text = re.sub(r"/\^\\p\{(?:gc=)?(Pi|Pf|Cn)\}\$/u.test\((state\.(?:cur|next)\.char)\)",
                          lambda match: "(unicodeCategory(" + match[2] + ".codePointAt(0)) === '" + match[1] + "')", text)
            text = text.replace(r"/^\p{ExtPict}$/u.test(state.cur.char)", "unicodeExtendedPictographic(state.cur.cp)")
        elif name == "state.js":
            text = "import {unicodeCategory} from '../../src/text/unicode-properties.js';\n" + text
            text = text.replace(r"/^[\p{gc=Mn}\p{gc=Mc}]$/u.test(char)", "['Mn', 'Mc'].includes(unicodeCategory(char.codePointAt(0)))")
            text = text.replace("constructor(str) {", "constructor(str, work) {\n    this.work = work;")
            text = text.replace("while (pos < this.len) {", "while (pos < this.len) {\n        this.work?.();")
            text = text.replace("while (pos > 0) {", "while (pos > 0) {\n        this.work?.();")
        write(target / name, text)
    for name in ["LineBreak", "EastAsianWidth"]:
        write(target / (name + ".js"), trie_module(source, name))
    (target / "trie").mkdir(exist_ok=True)
    for name in ["LICENSE", "constants.js"]:
        shutil.copyfile(trie_source / name, target / "trie" / name)
    text = (trie_source / "index.js").read_text()
    text = re.sub(r"import \{gunzipSync\}[^\n]+\n|import \{swap32LE\}[^\n]+\n", "", text)
    text = text.replace("const DECODER = new TextDecoder();", "")
    start = text.index("  constructor(data) {")
    end = text.index("  /**\n   * Get the value associated", start)
    text = text[:start] + "  constructor({data, highStart, errorValue, values = []}) {\n" \
        + "    Object.assign(this, {data, highStart, errorValue, values});\n  }\n\n" + text[end:]
    write(target / "trie" / "index.js", text)


def parse_ranges(path, select):
    ranges = []
    for line in path.read_text().splitlines():
        fields = line.split("#", 1)[0].strip().split(";")
        if len(fields) < 2:
            continue
        value = select([field.strip() for field in fields[1:]])
        if value is None:
            continue
        points = fields[0].strip().split("..")
        ranges.append([int(points[0], 16), int(points[-1], 16), value])
    ranges.sort(key=lambda row: row[0])
    merged = []
    for first, last, value in ranges:
        if merged and merged[-1][1] + 1 == first and merged[-1][2] == value:
            merged[-1][1] = last
        else:
            merged.append([first, last, value])
    return merged


def property_module(path, ranges, default):
    names = [default] + sorted({row[2] for row in ranges} - {default})
    ids = {name: index for index, name in enumerate(names)}
    data = [value for first, last, name in ranges for value in [first, last, ids[name]]]
    rows = [", ".join(map(str, data[start:start + 18])) for start in range(0, len(data), 18)]
    write(path, "// Generated from Unicode17 property data; see provenance.json.\n"
          + "export const names = Object.freeze(" + json.dumps(names) + ");\n"
          + "export const ranges = new Uint32Array([\n  " + ",\n  ".join(rows) + "\n]);\n")


def copy_properties(source, target):
    shutil.copyfile(source / "LICENSE", target / "LICENSE")
    aliases = {}
    for line in (source / "PropertyValueAliases.txt").read_text().splitlines():
        fields = [value.strip() for value in line.split("#", 1)[0].split(";")]
        if len(fields) > 2 and fields[0] == "sc":
            aliases[fields[2]] = fields[1]
    property_module(target / "scripts.js", parse_ranges(source / "Scripts.txt", lambda fields: aliases[fields[0]]), "Zzzz")
    property_module(target / "graphemes.js", parse_ranges(source / "GraphemeBreakProperty.txt", lambda fields: fields[0]), "Other")
    property_module(target / "categories.js", parse_ranges(source / "DerivedGeneralCategory.txt", lambda fields: fields[0]), "Cn")
    for name, field in [("extended-pictographic", "Extended_Pictographic"), ("emoji-presentation", "Emoji_Presentation")]:
        property_module(target / (name + ".js"), parse_ranges(source / "emoji-data.txt",
                        lambda fields: "Yes" if fields[0] == field else None), "No")
    derived = source / "DerivedCoreProperties-subset.txt"
    property_module(target / "indic-conjunct.js", parse_ranges(derived,
                    lambda fields: fields[1] if fields[0] == "InCB" else None), "None")
    property_module(target / "default-ignorable.js", parse_ranges(derived,
                    lambda fields: "Yes" if fields[0] == "Default_Ignorable_Code_Point" else None), "No")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkouts", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    for name in ["bidi", "linebreak", "unicode"]:
        (args.target / name).mkdir(parents=True, exist_ok=True)
    copy_bidi(args.checkouts / "bidi-js", args.target / "bidi")
    copy_linebreak(args.checkouts / "linebreak", args.checkouts / "unicode-trie", args.target / "linebreak")
    copy_properties(args.checkouts / "unicode", args.target / "unicode")
    provenance = {
        "schemaVersion": 1,
        "bidi": {"repository": "https://github.com/lojjic/bidi-js", "commit": "953d75cb176f0693aa77d60cdf3afde5f2a0927a",
                 "unicodeVersion": "13.0.0", "transforms": ["named ESM imports and semicolons", "L1 trailing whitespace uses line-relative index"]},
        "linebreak": {"repository": "https://github.com/cto-af/linebreak", "commit": "088ff02569c5f213951e819a0578f164455f1075",
                      "unicodeVersion": "17.0.0", "transforms": ["preinflate generated immutable trie data; eliminate runtime gzip dependency",
                      "inject optional per-step work callback into forward/backward codepoint iteration",
                      "replace host-version Unicode regex properties with the pinned Unicode17 lookup"]},
        "trie": {"repository": "https://github.com/cto-af/unicode-trie", "tree": "5523d847380ebea9896e3a4f406fdaf134cf27ad",
                 "transforms": ["retain original get/getString; accept pre-parsed data only"]},
        "unicode": {"repository": "https://github.com/unicode-org/unicodetools", "version": "17.0.0", "blobs": {
            "Scripts.txt": "5574fdd6ae35ddc074397fdc60fbe2e27e795713",
            "GraphemeBreakProperty.txt": "19b13571f347af21a499eeb5ac0f27fc4602dacd",
            "emoji-data.txt": "450252c4df3fc9477f6df6635f7b4aaf61db5a0f",
            "DerivedCoreProperties.txt": "f327784bf3956436efeb85e213fc637d7b3c0207",
            "PropertyValueAliases.txt": "b92662eda2867baed56e55440e5187d52c1cb341",
            "DerivedGeneralCategory.txt": "41996d6348fdcd7f1a88127766b7e6b21b6159e3"},
            "transforms": ["sort/merge equal property ranges; map script long names to ISO15924 tags; retain selected InCB/default-ignorable properties"]}
    }
    for name in ["bidi", "linebreak", "unicode"]:
        data = {"sources": provenance, "sha256": {str(path.relative_to(args.target / name)): digest(path)
                for path in sorted((args.target / name).rglob("*")) if path.is_file() and path.name != "provenance.json"}}
        write(args.target / name / "provenance.json", json.dumps(data, indent=2) + "\n")


if __name__ == "__main__":
    main()
