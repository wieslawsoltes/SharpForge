"""Bounded lexical inventory; never expands macros or claims Rust soundness."""
import hashlib
import os
import re
import stat
from bisect import bisect_right
from pathlib import Path

RAW_LITERAL = re.compile(r'(?:br|cr|r)(#{0,255})"')
STRING_LITERAL = re.compile(r'(?:b|c)?"')
CHARACTER_LITERAL = re.compile(r"b?'(?:[^'\\\n]|\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.))'")
IDENTIFIER = re.compile(r'(?:r#)?[^\W\d]\w*', re.UNICODE)

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024
MAX_FILES = 4096


def quoted_end(source, start, quote):
    cursor = start + 1
    while cursor < len(source):
        if source[cursor] == '\\':
            cursor += 2
        elif source[cursor] == quote:
            return cursor + 1
        else:
            cursor += 1
    raise ValueError('Unterminated Rust string literal')


def block_comment_end(source, start):
    cursor, depth = start + 2, 1
    while cursor < len(source):
        if source.startswith('/*', cursor):
            depth += 1
            if depth > 128:
                raise ValueError('Rust comment nesting exceeds 128')
            cursor += 2
        elif source.startswith('*/', cursor):
            depth -= 1
            cursor += 2
            if not depth:
                return cursor
        else:
            cursor += 1
    raise ValueError('Unterminated Rust block comment')


def lex(source):
    """Return code tokens and comments with offsets, ignoring Rust literals."""
    tokens, comments, cursor = [], [], 0
    while cursor < len(source):
        start = cursor
        if source[cursor].isspace():
            cursor += 1
            continue
        if source.startswith('//', cursor):
            end = source.find('\n', cursor)
            cursor = len(source) if end < 0 else end
            comments.append((start, cursor, source[start:cursor]))
            continue
        if source.startswith('/*', cursor):
            cursor = block_comment_end(source, cursor)
            comments.append((start, cursor, source[start:cursor]))
            continue
        raw = RAW_LITERAL.match(source, cursor)
        if raw:
            end = source.find('"' + raw[1], cursor + len(raw[0]))
            if end < 0:
                raise ValueError('Unterminated Rust raw string literal')
            cursor = end + 1 + len(raw[1])
            tokens.append(('<literal>', start, cursor))
            continue
        string = STRING_LITERAL.match(source, cursor)
        if string:
            cursor = quoted_end(source, cursor + len(string[0]) - 1, '"')
            tokens.append(('<literal>', start, cursor))
            continue
        # A lifetime has no closing quote; a character has one scalar or escape.
        character = CHARACTER_LITERAL.match(source, cursor)
        if character:
            cursor += len(character[0])
            tokens.append(('<literal>', start, cursor))
            continue
        identifier = IDENTIFIER.match(source, cursor)
        if identifier:
            cursor += len(identifier[0])
            tokens.append((identifier[0], start, cursor))
            continue
        cursor += 1
        tokens.append((source[start:cursor], start, cursor))
    return tokens, comments


def safety_comment(source, start, comments):
    """Accept a nonempty rationale immediately before the block's statement."""
    if not comments:
        return None
    first, end, body = comments[-1]
    between = source[end:start]
    if between.count('\n') > 1 or any(mark in between for mark in ';{}'):
        return None
    # Do not borrow a trailing comment from the previous statement.
    line_prefix = source[source.rfind('\n', 0, first) + 1:first]
    if '\n' in between and line_prefix.strip():
        return None
    match = re.search(r'\bSAFETY:[ \t]*([^\r\n]+)', body)
    rationale = match[1].removesuffix('*/').strip(' *') if match else ''
    return rationale or None


def scan_source(source):
    """Inventory every unsafe keyword; enforce rationale for unsafe blocks."""
    tokens, comments = lex(source)
    line_starts = [0] + [index + 1 for index, value in enumerate(source) if value == '\n']
    entries, preceding, comment_index = [], [], 0
    for index, (value, start, end) in enumerate(tokens):
        if value != 'unsafe':
            continue
        while comment_index < len(comments) and comments[comment_index][1] <= start:
            preceding.append(comments[comment_index])
            comment_index += 1
        next_value = tokens[index + 1][0] if index + 1 < len(tokens) else ''
        kind = 'block' if next_value == '{' else next_value if next_value in ('fn', 'impl', 'trait', 'extern') else 'other'
        rationale = safety_comment(source, start, preceding)
        line = bisect_right(line_starts, start)
        entries.append({'line': line, 'column': start - line_starts[line - 1] + 1, 'kind': kind,
                        'safetyComment': rationale, 'violation': kind == 'block' and not rationale})
    return entries


def source_files(root, crate):
    directory = root / 'rust' / crate
    for component in (root / 'rust', directory):
        if component.is_symlink():
            raise ValueError(f'Symlink cannot be inventoried: {component}')
    if not directory.exists():
        return []
    files, visited = [], 0
    def fail(error):
        raise error
    for parent, directories, names in os.walk(directory, followlinks=False, onerror=fail):
        visited += 1
        if visited > MAX_FILES:
            raise ValueError(f'Rust inventory exceeds {MAX_FILES} directories')
        directories[:] = sorted(name for name in directories if name not in ('target', '.git'))
        for name in directories + sorted(names):
            path = Path(parent) / name
            if path.is_symlink():
                raise ValueError(f'Symlink cannot be inventoried: {path}')
        files.extend(Path(parent) / name for name in sorted(names) if name.endswith('.rs'))
        if len(files) > MAX_FILES:
            raise ValueError(f'Rust inventory exceeds {MAX_FILES} files')
    return sorted(files)


def inventory(root, crate):
    """Read the actual crate tree, reject bounds and retain per-file hashes."""
    files, entries, total = [], [], 0
    for path in source_files(root, crate):
        details = path.stat()
        if not stat.S_ISREG(details.st_mode):
            raise ValueError(f'Rust source must be a regular file: {path}')
        size = details.st_size
        total += size
        if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
            raise ValueError('Rust inventory source byte limit exceeded')
        data = path.read_bytes()
        name = path.relative_to(root).as_posix()
        rows = scan_source(data.decode('utf-8'))
        files.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        entries.extend(dict(row, path=name) for row in rows)
    manifest = root / 'rust' / crate / 'Cargo.toml'
    if manifest.is_symlink():
        raise ValueError('Crate manifest cannot be a symlink')
    present = manifest.is_file()
    failed = any(row['violation'] for row in entries) or (present and not files)
    return {'status': 'failed' if failed else 'passed' if present else 'unsupported',
            'qualified': False, 'files': files, 'entries': entries,
            'reason': 'No Rust source files' if present and not files else None if present else 'Crate manifest is absent',
            'unsafeBlocks': sum(row['kind'] == 'block' for row in entries),
            'violations': sum(bool(row['violation']) for row in entries)}
