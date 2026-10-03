"""Validate the actual full CycloneDX schema offline with the hash-pinned jsonschema validator."""
import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = ROOT / 'planning/qualification/supply/cyclonedx'


def validate(document, schemas=SCHEMAS):
    """Reject missing schema references, malformed BOMs and duplicate component identities."""
    registry = Registry()
    for path in sorted(schemas.glob('*.schema.json')):
        schema = json.loads(path.read_text(encoding='utf8'))
        Draft7Validator.check_schema(schema)
        resource = Resource.from_contents(schema)
        for uri in [schema['$id'], 'http://cyclonedx.org/schema/' + path.name,
                    'https://cyclonedx.org/schema/' + path.name]:
            registry = registry.with_resource(uri, resource)
    schema = json.loads((schemas / 'bom-1.6.schema.json').read_text(encoding='utf8'))
    Draft7Validator(schema, registry=registry).validate(document)
    identities = [item['bom-ref'] for item in document['components']]
    if len(identities) != len(set(identities)):
        raise ValueError('SBOM_IDENTITY: duplicate component identity')
    return len(identities)


if __name__ == '__main__':
    document = json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
    print(json.dumps({'status': 'pass', 'schema': 'CycloneDX 1.6', 'components': validate(document)}))
