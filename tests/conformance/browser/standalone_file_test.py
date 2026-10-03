"""Actual file:// navigation. Never set_content or replace native browser storage."""
from pathlib import Path
import sys
_ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(_ROOT/'tests'))

from pathlib import Path
import os
from conformance.browser.matrix_common import ROOT, load, smoke

def qualify(checks, **options):
    path = Path(os.getenv('SHARPFORGE_STANDALONE_PATH', str(ROOT/'artifacts/SharpForge-standalone.html'))).resolve()
    checks.check('file-navigation', lambda: load(checks.page, path.as_uri(), mode='file'))
    smoke(checks, mode='file', iterations=options.get('iterations',3))

if __name__=='__main__':
    import os, subprocess
    sys.exit(subprocess.call([sys.executable,str(_ROOT/'tests/conformance/browser/matrix.py'),'--engine',os.getenv('SHARPFORGE_BROWSER_ENGINE','chromium'),'--mode','file'],cwd=_ROOT))
