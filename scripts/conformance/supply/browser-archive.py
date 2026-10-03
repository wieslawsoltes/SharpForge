"""Package bounded browser inputs; T09 separately owns reproducibility qualification."""
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[3]


def create(root=ROOT):
    directory = root / 'dist'
    destination = root / 'artifacts/SharpForge-browser.zip'
    for path in [root, directory, destination.parent]:
        if path.is_symlink() or not path.is_dir():
            raise ValueError('ARCHIVE_INPUT: linked or missing directory')
    if destination.is_symlink():
        raise ValueError('ARCHIVE_OUTPUT: linked output file')
    paths = []
    total = 0
    for parent, directories, files in os.walk(directory, followlinks=False):
        for name in directories + files:
            if (Path(parent) / name).is_symlink():
                raise ValueError('ARCHIVE_INPUT: symlink')
        for name in files:
            path = Path(parent) / name
            size = path.stat().st_size
            total += size
            if not path.is_file() or size > 64 * 1024 * 1024 or total > 512 * 1024 * 1024 or len(paths) >= 30000:
                raise ValueError('ARCHIVE_INPUT: input limits exceeded')
            paths.append(path)
    if not paths:
        raise ValueError('ARCHIVE_INPUT: empty distribution')
    with ZipFile(destination, 'w', compression=ZIP_DEFLATED) as archive:
        for path in sorted(paths):
            archive.write(path, path.relative_to(directory).as_posix())


if __name__ == '__main__':
    create()
