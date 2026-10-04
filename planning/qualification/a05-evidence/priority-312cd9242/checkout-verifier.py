"""Read-only product verification; write metadata only outside the measured worktree."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone


def git(directory, *arguments):
    return subprocess.check_output(['git', *arguments], cwd=directory)


def verify(directory, expected_revision, expected_tree):
    directory = directory.resolve(strict=True)
    actual = git(directory, 'rev-parse', 'HEAD').decode().strip()
    tree = git(directory, 'rev-parse', 'HEAD^{tree}').decode().strip()
    if actual != expected_revision or tree != expected_tree:
        raise ValueError('Exact published revision/tree mismatch')
    status = git(directory, 'status', '--porcelain=v1', '--untracked-files=all').decode().strip()
    if status:
        raise ValueError('Product must be completely clean: ' + status)
    subprocess.run(['git', 'diff', '--cached', '--quiet', 'HEAD'], cwd=directory, check=True)
    algorithm = git(directory, 'rev-parse', '--show-object-format').decode().strip()
    count, total_bytes, index_count = 0, 0, 0
    inventory = hashlib.sha256()
    for entry in git(directory, 'ls-files', '--stage', '-z').split(b'\0'):
        if not entry:
            continue
        metadata, encoded_path = entry.split(b'\t', 1)
        mode, expected_blob, stage = metadata.decode().split()
        if stage != '0':
            raise ValueError('Unmerged index entry')
        path = directory / os.fsdecode(encoded_path)
        index_count += 1
        if not path.exists() and not path.is_symlink():
            continue
        if mode == '120000' and path.is_symlink():
            contents = os.fsencode(os.readlink(path))
        elif mode in ('100644', '100755') and path.is_file() and not path.is_symlink():
            contents = path.read_bytes()
            if bool(path.stat().st_mode & 0o111) != (mode == '100755'):
                raise ValueError('Executable mode mismatch: ' + str(path))
        else:
            raise ValueError('Unexpected materialized tracked object: ' + str(path))
        digest = hashlib.new(algorithm, b'blob ' + str(len(contents)).encode() + b'\0' + contents).hexdigest()
        if digest != expected_blob:
            raise ValueError('Tracked bytes differ from index/commit: ' + str(path))
        inventory.update(encoded_path + b'\0' + expected_blob.encode() + b'\0')
        count += 1
        total_bytes += len(contents)
    package_links = []
    expected_names = set()
    modules = directory / 'node_modules'
    if modules.is_symlink() or not modules.is_dir():
        raise ValueError('Product node_modules must be its own real directory')
    for manifest in sorted((directory / 'packages').glob('*/package.json')):
        name = json.loads(manifest.read_text())['name']
        if not name.startswith('@sharpforge/'):
            raise ValueError('Unexpected workspace scope: ' + name)
        expected_names.add(name.removeprefix('@sharpforge/'))
        link = modules / name
        target = manifest.parent.resolve()
        if not link.is_symlink() or link.resolve(strict=True) != target:
            raise ValueError('Product workspace link does not resolve to its own package: ' + name)
        package_links.append({'name': name, 'link': str(link), 'relativeTarget': os.readlink(link), 'resolvedTarget': str(target)})
    if {path.name for path in (modules / '@sharpforge').iterdir()} != expected_names:
        raise ValueError('Workspace package-link inventory differs from own package manifests')
    for link in modules.rglob('*'):
        if link.is_symlink() and not link.resolve(strict=True).is_relative_to(directory):
            raise ValueError('Product dependency links outside the immutable checkout: ' + str(link))
    sparse_path = Path(git(directory, 'rev-parse', '--git-path', 'info/sparse-checkout').decode().strip())
    if not sparse_path.is_absolute():
        sparse_path = directory / sparse_path
    patterns = sparse_path.read_text()
    if git(directory, 'status', '--porcelain=v1', '--untracked-files=all').decode().strip():
        raise ValueError('Product changed during verification')
    if git(directory, 'rev-parse', 'HEAD').decode().strip() != actual:
        raise ValueError('Product revision changed during verification')
    return {'status': 'verified', 'verifiedAt': datetime.now(timezone.utc).isoformat(),
            'productDirectory': str(directory), 'revision': actual, 'fullTree': tree,
            'runtimeTree': git(directory, 'rev-parse', 'HEAD:packages/runtime/src').decode().strip(),
            'harnessTree': git(directory, 'rev-parse', 'HEAD:bench/vm').decode().strip(),
            'worktreeStatus': '', 'trackedFilesInIndex': index_count, 'materializedTrackedFiles': count,
            'materializedTrackedBytes': total_bytes, 'materializedInventorySHA256': inventory.hexdigest(),
            'allMaterializedTrackedBytesMatchGit': True, 'workspaceLinks': package_links,
            'sparsePatterns': patterns, 'sparsePatternsSha256': hashlib.sha256(patterns.encode()).hexdigest(),
            'verifierSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'scope': 'Read-only checkout identity and own-package resolution; no runtime or performance execution.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--product', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--tree', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(args.product.resolve()):
        raise ValueError('Verification metadata must be outside the measured checkout')
    result = verify(args.product, args.revision, args.tree)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf8') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
    print(json.dumps({key: result[key] for key in ('status', 'revision', 'fullTree', 'materializedTrackedFiles')}))


if __name__ == '__main__':
    main()
