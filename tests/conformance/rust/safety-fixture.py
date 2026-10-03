"""Offline fixture bridge: simulated process results never invoke Cargo."""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts/conformance/rust'))
from safety_execute import command_environment, execute, test_evidence
from safety_plan import plan
from source_inventory import inventory, scan_source

request = json.load(sys.stdin)
operation = request['operation']
if operation == 'scan':
    response = scan_source(request['source'])
elif operation == 'plan':
    response = plan(Path(request['root']), request['crate'], request['lane'], tuple(request.get('host', ['linux', 'x86_64'])))
elif operation == 'inventory':
    response = inventory(Path(request['root']), request['crate'])
elif operation == 'evidence':
    response = test_evidence(request['output'])
elif operation == 'environment':
    os.environ.update(request['environment'])
    response = command_environment({'RUSTFLAGS': '-Zsanitizer=address'})
    response = {key: value for key, value in response.items() if key in request['environment'] or key == 'RUSTFLAGS'}
elif operation == 'execute':
    responses = iter(request['responses'])
    def runner(command, root, timeout):
        response = next(responses)
        if response.get('raise'):
            raise OSError(response['raise'])
        return response
    response = execute(Path(request['root']), request['report'], 1, runner)
else:
    raise ValueError('Unknown fixture operation')
print(json.dumps(response))
