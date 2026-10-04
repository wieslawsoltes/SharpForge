"""Pinned official UI acquisition and actual rendered-profile assertions; no parser substitute."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import urllib.request
import zipfile

PIN = {
    'version': '1.24.0',
    'commit': 'fc76932551754a442cd5c4f0afdba28032d14d8a',
    'release': 'https://github.com/jlfwong/speedscope/releases/tag/v1.24.0',
    'url': 'https://github.com/jlfwong/speedscope/releases/download/v1.24.0/speedscope-1.24.0.zip',
    'sha256': '1cd7de1f33e7a56a0b08ca51b4ba9598b766676f9c5f07077e731258d47e6121',
    'bytes': 218392,
}


def unpack_official(data, directory):
    if len(data) != PIN['bytes'] or hashlib.sha256(data).hexdigest() != PIN['sha256']:
        raise ValueError('Official Speedscope ZIP length or SHA-256 does not match the reviewed pin')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 100 or sum(item.file_size for item in members) > 8 * 1024 * 1024:
            raise ValueError('Speedscope ZIP exceeds qualification extraction budget')
        for item in members:
            path = PurePosixPath(item.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in item.filename or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError('Unsafe Speedscope ZIP member: ' + item.filename)
        files = []
        for item in members:
            if item.is_dir():
                continue
            path = directory / item.filename
            path.parent.mkdir(parents=True, exist_ok=True)
            content = archive.read(item)
            path.write_bytes(content)
            files.append({'path': item.filename, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    entries = [item['path'] for item in files if PurePosixPath(item['path']).name == 'index.html']
    if len(entries) != 1:
        raise ValueError('Pinned official release must have exactly one index.html')
    return {**PIN, 'entry': entries[0], 'files': files}


def prepare(directory):
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / 'speedscope.zip'
    if not archive.is_file():
        request = urllib.request.Request(PIN['url'], headers={'User-Agent': 'SharpForge-A05-browser-qualification'})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(PIN['bytes'] + 1)
        # Failed or substituted downloads never become a reusable cache.
        if len(data) != PIN['bytes'] or hashlib.sha256(data).hexdigest() != PIN['sha256']:
            raise ValueError('Downloaded official Speedscope release differs from its pinned digest')
        archive.write_bytes(data)
    manifest = unpack_official(archive.read_bytes(), directory / 'ui')
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    return manifest


def verify(directory):
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf8'))
    if any(manifest.get(key) != value for key, value in PIN.items()):
        raise ValueError('Speedscope asset manifest does not match the reviewed official release')
    archive = (directory / 'speedscope.zip').read_bytes()
    if len(archive) != PIN['bytes'] or hashlib.sha256(archive).hexdigest() != PIN['sha256']:
        raise ValueError('Cached Speedscope ZIP does not match the reviewed official release')
    # Re-extract the verified archive, so a modified loose UI asset cannot qualify.
    actual = unpack_official(archive, directory / 'ui')
    if actual != manifest:
        raise ValueError('Speedscope extracted asset manifest mismatch')
    return actual


def assert_table(rows, expected):
    actual = {}
    for cells in rows:
        if len(cells) != 3:
            continue
        name = cells[2].strip()
        if name in actual:
            raise AssertionError('Duplicate displayed method: ' + name)
        counts = []
        for text in cells[:2]:
            match = re.fullmatch(r'([0-9][0-9,]*)\s+\([0-9.]+%\)', text.strip())
            if not match:
                raise AssertionError('Unexpected Speedscope rendered count: ' + repr(text))
            counts.append(int(match[1].replace(',', '')))
        actual[name] = {'name': name, 'total': counts[0], 'self': counts[1]}
    wanted = {method['name']: method for method in expected['methods']}
    if actual != wanted:
        raise AssertionError('Displayed method counts differ from VM records: ' + repr({'actual': actual, 'expected': wanted}))
    observed_total = sum(method['self'] for method in actual.values())
    if observed_total != expected['instructions']:
        raise AssertionError('Sum of displayed Self counts differs from actual executed instructions')
    return {'methods': list(actual.values()), 'displayedSelfSum': observed_total,
            'recordedInstructions': expected['instructions']}


def import_file(page, url, file, expected, directory):
    errors, dialogs = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
    response = page.goto(url)
    if response is None or response.status != 200:
        raise AssertionError('Official Speedscope UI did not load over HTTP')
    page.locator('#file').set_input_files(str(file))
    page.wait_for_function('(name) => document.title === name + " - speedscope"', arg=expected['name'])
    # The official v1.24 application handles this keyboard shortcut; no app state injection.
    page.keyboard.press('3')
    page.get_by_text('Symbol Name', exact=True).wait_for(state='visible')
    for method in expected['methods']:
        page.get_by_text(method['name'], exact=True).wait_for(state='visible')
    rows = page.locator('tr').evaluate_all('(rows) => rows.map(row => [...row.querySelectorAll("td")].map(cell => cell.innerText))')
    observation = {'title': page.title(), 'rows': rows, 'pageErrors': errors, 'dialogs': dialogs}
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'dom.json').write_text(json.dumps(observation, indent=2) + '\n', encoding='utf8')
    (directory / 'body.txt').write_text(page.locator('body').inner_text(), encoding='utf8')
    page.screenshot(path=str(directory / 'speedscope.png'), full_page=True)
    if errors or dialogs:
        raise AssertionError('Speedscope import emitted a page error or dialog: ' + repr(observation))
    return {'passed': True, 'fileSha256': hashlib.sha256(file.read_bytes()).hexdigest(), **assert_table(rows, expected)}
