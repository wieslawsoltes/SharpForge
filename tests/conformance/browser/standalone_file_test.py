"""Actual file:// navigation. Never set_content or replace native browser storage."""
from pathlib import Path
import os
from conformance.browser.matrix_common import ROOT, load, smoke

def qualify(checks, **options):
    path = Path(os.getenv('SHARPFORGE_STANDALONE_PATH', str(ROOT/'artifacts/SharpForge-standalone.html'))).resolve()
    checks.check('file-navigation', lambda: load(checks.page, path.as_uri(), mode='file'))
    smoke(checks, mode='file', iterations=options.get('iterations',3))
