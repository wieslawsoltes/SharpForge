"""Regenerate the fully hashed wheel lock from an explicit pip resolution report.

The resolution command is documented in planning/qualification/supply/README.md.
Only PyPI metadata is downloaded; package code is never executed by this writer.
"""
import argparse
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[3]


def package_record(item):
    metadata = item['metadata']
    name, version = metadata['name'], metadata['version']
    if not all(character.isalnum() or character in '._-' for character in name + version):
        raise ValueError('Invalid package identity')
    url = f'https://pypi.org/pypi/{name}/{version}/json'
    with urlopen(url, timeout=30) as response:
        data = json.load(response)
    files = [{'filename': file['filename'], 'sha256': file['digests']['sha256'], 'url': file['url']}
             for file in data['urls'] if file['packagetype'] == 'bdist_wheel']
    if not files:
        raise ValueError('No binary wheels for ' + name)
    return {'name': name, 'version': version, 'metadataUrl': url,
            'requiresPython': data['info']['requires_python'],
            'licenseExpression': data['info'].get('license_expression'),
            'license': data['info'].get('license'), 'requiresDist': data['info'].get('requires_dist', []), 'files': files}


def render_lock(packages):
    lines = ['# Regenerate with scripts/conformance/supply/lock-python.py; all transitive dependencies are explicit.',
             '# Runtime product remains dependency-free. Install with --require-hashes --only-binary=:all:.']
    for package in packages:
        hashes = sorted({file['sha256'] for file in package['files']})
        lines.append(package['name'] + '==' + package['version'] + ' \\')
        lines.extend('    --hash=sha256:' + digest + (' \\' if index < len(hashes) - 1 else '')
                     for index, digest in enumerate(hashes))
    return '\n'.join(lines) + '\n'


def resolved_roots(resolution):
    return [item['metadata']['name'] + '==' + item['metadata']['version']
            for item in resolution['install'] if item['requested']]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resolution', type=Path, required=True)
    parser.add_argument('--date', required=True, help='Reviewed resolution date, YYYY-MM-DD')
    args = parser.parse_args()
    resolution = json.loads(args.resolution.read_text())
    packages = sorted((package_record(item) for item in resolution['install']), key=lambda item: item['name'].lower())
    report = {'schemaVersion': 1, 'roots': resolved_roots(resolution),
              'resolvedOn': args.date,
              'metadata': 'PyPI version endpoints; hashes cover official wheels; execution qualifies only measured targets',
              'packages': packages}
    (ROOT / 'tests/requirements.txt').write_text(render_lock(packages))
    (ROOT / 'planning/qualification/supply/python-lock.json').write_text(json.dumps(report, indent=2) + '\n')
