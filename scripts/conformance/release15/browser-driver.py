"""Release-specific steps using the existing T12 browser session and RPC loop."""
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('acceptance_studio', ROOT / 'scripts/conformance/acceptance/studio-driver.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
sys.path.insert(0, str(Path(__file__).parent))
from documents import documents, geometry
from rendering import render, device_loss
from sessions import sessions


def dispatch(page, step):
    action = step['action']
    if action == 'documents':
        return documents(page, ROOT)
    if action == 'sessions':
        return sessions(page, ROOT, base.OUTPUT)
    if action == 'geometry':
        return geometry(page, base.OUTPUT)
    if action in ('canvas2d', 'dom', 'webgpu'):
        return render(page, action)
    if action == 'device-loss':
        return device_loss(page)
    return base.dispatch(page, step)


if __name__ == '__main__':
    base.main(dispatch)
