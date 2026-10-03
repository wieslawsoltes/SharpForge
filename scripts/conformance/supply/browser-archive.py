"""Create a bounded local browser payload for SBOM verification; T09 owns reproducibility qualification."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[3]


def create(root=ROOT):
    directory = root / 'dist'
    paths = sorted(path for path in directory.rglob('*') if path.is_file())
    if not paths or len(paths) > 30000:
        raise ValueError('ARCHIVE_INPUT: empty or excessive distribution')
    with ZipFile(root / 'artifacts/SharpForge-browser.zip', 'w', compression=ZIP_DEFLATED) as archive:
        for path in paths:
            if path.is_symlink():
                raise ValueError('ARCHIVE_INPUT: symlink')
            archive.write(path, path.relative_to(directory).as_posix())


if __name__ == '__main__':
    create()
