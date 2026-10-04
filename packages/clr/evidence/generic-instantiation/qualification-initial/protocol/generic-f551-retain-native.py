import datetime
import hashlib
import json
from pathlib import Path

root = Path('/workspace/scratch/7e3d2a445c44')
qualification = root / 'generic-qualification-f551d51c'
source = qualification / 'native-first'
repo = root / 'sf6-generic-instantiation'
plan = json.loads((root / 'generic-f551-validation-plan.json').read_bytes())
step = next(item for item in plan['steps'] if item['id'] == 'review-and-import-native')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

status = json.loads((source / 'capture-status.json').read_bytes())
inputs = json.loads((source / 'capture-inputs.json').read_bytes())
native = json.loads((source / 'native-instantiation.json').read_bytes())
raw = json.loads((source / 'native-observer.stdout.txt').read_bytes())
labels = ['sdk-version', 'sdk-list', 'compiler-version', 'compile-fixture', 'compile-observer', 'native-observer']
assert status['status'] == 'passed'
assert [command['label'] for command in status['commands']] == labels
for command in status['commands']:
    assert command['status'] == 'passed' and command['exitCode'] == 0 and command['signal'] is None
    for stream in ['stdout', 'stderr']:
        assert (source / (command['label'] + '.' + stream + '.txt')).is_file()
assert native['schemaVersion'] == 2 and native['sdk'] == '10.0.201'
assert native['runtime'] == '10.0.5' and native['referencePack'] == '10.0.5'
assert native['captureInputSha256'] == digest(source / 'capture-inputs.json')
assert inputs['head'] == 'f551d51c26ccb4460c0300cea5069a77e8b34a8a' and not inputs['trackedChanges']
assert len(native['cases']) == 101 and len({item['id'] for item in native['cases']}) == 101
assert len(native['lifetime']['reference']['cases']) == 7
assert all(native[key] == value for key, value in raw.items() if key != 'images')
assert len(raw['images']) == 5 and len(native['images']) == 6
assert native['images'][0]['id'] == 'fixture' and native['images'][0]['file'] == 'Fixture.dll'
for raw_image, retained_image in zip(raw['images'], native['images'][1:]):
    assert {key: value for key, value in retained_image.items() if key not in ['bytes', 'sha256']} == raw_image
assert native['sources'] == inputs['sources'] and len(inputs['sources']) == 8
for pin in inputs['sources']:
    assert digest(repo / pin['path']) == pin['sha256']
for pin in native['images']:
    assert len((source / pin['file']).read_bytes()) == pin['bytes']
    assert digest(source / pin['file']) == pin['sha256']
assert digest(source / 'GenericInstantiationOracle.dll') == native['observerSha256']
assert digest(source / 'GenericInstantiationOracle.runtimeconfig.json') == native['runtimeConfigSha256']
assert digest(root / 'dotnet-10.0.201/sdk/10.0.201/Roslyn/bincore/csc.dll') == native['compilerSha256']
references = root / 'dotnet-10.0.201/packs/Microsoft.NETCore.App.Ref/10.0.5/ref/net10.0'
assert len(native['referenceAssemblies']) == 167
for pin in native['referenceAssemblies']:
    assert digest(references / pin['name']) == pin['sha256']
assert len(step['files']) == 23
assert {path.name for path in source.iterdir()} == set(step['files'])
destination = Path(step['destination'])
assert all(not (destination / name).exists() for name in step['files'])
records = []
for name in step['files']:
    data = (source / name).read_bytes()
    target = destination / name
    with target.open('xb') as output:
        output.write(data)
    assert target.read_bytes() == data
    records.append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
receipt = {
    'completedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'source': str(source), 'destination': str(destination), 'sourceHead': inputs['head'],
    'retentionScriptSha256': digest(Path(__file__)),
    'nativeSha256': digest(source / 'native-instantiation.json'),
    'inputSha256': digest(source / 'capture-inputs.json'),
    'allSixCommandsPassed': True, 'allEightSourcesMatch': True, 'all167ReferenceAssembliesMatch': True,
    'rawComparison': 'Every raw JSON field matches, except images: five raw SRM image facts match exactly after removing only added bytes/sha256; the sixth image is the independently compiled Fixture.dll. All six file bytes/hashes are checked.',
    'cases': 101, 'lifetimeCases': 7, 'images': 6, 'files': records,
    'totalBytes': sum(item['bytes'] for item in records),
    'nativeRejections': [item['id'] for item in native['cases'] if item.get('error')],
    'identities': {state: sum(item['status'] == state for item in native['identities']) for state in ['observed', 'unavailable']},
    'scope': 'Native operation/identity observations only; no current-product or performance pass is asserted.',
}
path = qualification / 'native-retention.json'
with path.open('x') as output:
    json.dump(receipt, output, indent=2)
    output.write('\n')
print(json.dumps({key: value for key, value in receipt.items() if key not in ['files', 'nativeRejections']}, indent=2))
print(json.dumps({'retentionReceiptSha256': digest(path), 'retentionScriptSha256': digest(Path(__file__))}))
