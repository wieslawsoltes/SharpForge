"""Download pinned implementation inputs, sequentially. Does not execute tests."""
import hashlib
import json
import pathlib
import sys
import tarfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[4]
MAX_BYTES = 512 * 1024 * 1024


def download(url, target, digest):
    hash_value = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(url, timeout=60) as response, target.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError('Archive size budget exceeded')
            hash_value.update(chunk)
            output.write(chunk)
    if hash_value.hexdigest() != digest:
        target.unlink()
        raise ValueError('Pinned archive hash mismatch')


def fetch(directory):
    directory.mkdir(parents=True, exist_ok=True)
    pins = json.loads((ROOT / 'planning/qualification/suites/pins.json').read_text())
    for pin in pins['sources']:
        archive = directory / (pin['name'] + '.tar.gz')
        download(pin['archiveURL'], archive, pin['archiveSHA256'])
        destination = directory / pin['name']
        destination.mkdir(exist_ok=False)
        count = total = 0
        with tarfile.open(archive) as source:
            for member in source:
                count += 1
                total += member.size
                if count > 200000 or total > 2 * 1024 ** 3:
                    raise ValueError('Expanded source archive budget exceeded')
                member.name = '/'.join(member.name.split('/')[1:])
                if member.name:
                    source.extract(member, destination, filter='data')
        print(pin['name'], pin['commit'])


def ilasm(directory, rid):
    pins = json.loads((ROOT / 'planning/qualification/suites/ilasm-pins.json').read_text())
    pin = next(item for item in pins['platforms'] if item['rid'] == rid)
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / (rid + '.nupkg')
    download(pin['url'], archive, pin['packageSHA256'])
    with zipfile.ZipFile(archive) as package:
        data = package.read(pin['entry'])
    if hashlib.sha256(data).hexdigest() != pin['sha256']:
        raise ValueError('Pinned ILAsm binary mismatch')
    executable = directory / pathlib.PurePosixPath(pin['entry']).name
    executable.write_bytes(data)
    executable.chmod(0o755)
    print(executable.resolve())


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'ilasm':
        ilasm(pathlib.Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 2:
        fetch(pathlib.Path(sys.argv[1]))
    else:
        raise SystemExit('fetch-upstream.py DEST | fetch-upstream.py ilasm DEST RID')
