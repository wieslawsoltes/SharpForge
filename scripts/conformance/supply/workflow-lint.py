"""Parse workflow YAML and enforce immutable actions, least privilege and safe script inputs."""
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
SHA = re.compile(r'^[a-f0-9]{40}$')
EXPRESSION = re.compile(r'\$\{\{(.*?)\}\}', re.S)


class WorkflowLoader(yaml.SafeLoader):
    """GitHub uses YAML 1.2 booleans; preserve the workflow's `on` key."""


WorkflowLoader.yaml_implicit_resolvers = {
    key: [(tag, pattern) for tag, pattern in values if tag != 'tag:yaml.org,2002:bool']
    for key, values in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
WorkflowLoader.add_implicit_resolver('tag:yaml.org,2002:bool', re.compile(r'^(?:true|false)$', re.I), list('tTfF'))


def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if not isinstance(key, str) or key in result:
            raise ValueError('WORKFLOW_YAML: duplicate or non-string key')
        result[key] = loader.construct_object(value_node, deep=True)
    return result


WorkflowLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def parse_workflow(text):
    """Reject duplicate keys, aliases and oversized YAML before policy evaluation."""
    if len(text.encode('utf8')) > 2 * 1024 * 1024:
        raise ValueError('WORKFLOW_LIMIT: YAML exceeds two MiB')
    for token in yaml.scan(text):
        if isinstance(token, (yaml.tokens.AnchorToken, yaml.tokens.AliasToken)):
            raise ValueError('WORKFLOW_ALIAS: aliases and anchors require explicit supported policy')
    value = yaml.load(text, Loader=WorkflowLoader)
    if not isinstance(value, dict):
        raise ValueError('WORKFLOW_YAML: expected mapping')
    return value


def check_reference(reference, root):
    if not isinstance(reference, str):
        raise ValueError('WORKFLOW_PIN: uses must be a literal string')
    if reference.startswith('./'):
        target = (root / reference).resolve()
        if not target.is_relative_to(root.resolve()) or not target.exists():
            raise ValueError('WORKFLOW_LOCAL: missing or escaped local action')
        return
    if reference.startswith('docker://'):
        if not re.fullmatch(r'docker://[^\s@]+@sha256:[a-f0-9]{64}', reference):
            raise ValueError('WORKFLOW_PIN: container action needs an immutable digest')
        return
    parts = reference.rsplit('@', 1)
    if len(parts) != 2 or not re.fullmatch(r'[\w.-]+/[\w.-]+(?:/[\w./-]+)?', parts[0]) or not SHA.fullmatch(parts[1]):
        raise ValueError('WORKFLOW_PIN: remote action requires a full commit SHA')


def check_permissions(value, allowed, context):
    if not isinstance(value, dict):
        raise ValueError('WORKFLOW_PERMISSIONS: explicit permission map required at ' + context)
    for permission, access in value.items():
        if access not in ('read', 'write', 'none'):
            raise ValueError('WORKFLOW_PERMISSIONS: invalid access at ' + context)
        if access == 'write' and permission not in allowed:
            raise ValueError('WORKFLOW_PERMISSIONS: unapproved write at ' + context + ':' + permission)


def check_script(script, matrix):
    if not isinstance(script, str):
        raise ValueError('WORKFLOW_SCRIPT: run must be a string')
    for expression in EXPRESSION.findall(script):
        expression = expression.strip()
        if expression.startswith('matrix.'):
            name = expression.removeprefix('matrix.')
            values = matrix.get(name) if isinstance(matrix, dict) else None
            additions = matrix.get('include', []) if isinstance(matrix, dict) else []
            if isinstance(values, list) and values and isinstance(additions, list):
                overrides = [item[name] for item in additions if isinstance(item, dict) and name in item]
                if all(isinstance(value, str) and re.fullmatch(r'[\w./-]+', value) for value in values + overrides):
                    continue
        raise ValueError('WORKFLOW_INJECTION: pass expressions through a quoted environment variable, not run')


def lint_document(document, filename, root, grants):
    """Validate parsed semantics. Local composites are scanned independently alongside workflows."""
    if 'jobs' not in document:
        steps = document.get('runs', {}).get('steps', [])
        for step in steps:
            if 'uses' in step:
                check_reference(step['uses'], root)
            if 'run' in step:
                check_script(step['run'], {})
        return
    check_permissions(document.get('permissions'), [], filename)
    triggers = document.get('on', {})
    if isinstance(triggers, str):
        triggers = [triggers]
    if 'pull_request_target' in triggers:
        raise ValueError('WORKFLOW_TRIGGER: pull_request_target is prohibited')
    for name, job in document['jobs'].items():
        allowed = grants.get(filename + '#' + name, [])
        check_permissions(job.get('permissions', document['permissions']), allowed, filename + '#' + name)
        if 'uses' in job:
            check_reference(job['uses'], root)
        matrix = job.get('strategy', {}).get('matrix', {})
        for step in job.get('steps', []):
            if 'uses' in step:
                check_reference(step['uses'], root)
            if 'run' in step:
                check_script(step['run'], matrix)


def lint(root=ROOT):
    policy = json.loads((root / 'planning/qualification/supply/workflow-permissions.json').read_text())
    files = sorted((root / '.github/workflows').glob('*.y*ml'))
    files += sorted((root / '.github/actions').glob('**/action.y*ml'))
    for path in files:
        lint_document(parse_workflow(path.read_text()), path.relative_to(root).as_posix(), root, policy['jobWriteGrants'])
    return len(files)


if __name__ == '__main__':
    print(json.dumps({'status': 'pass', 'workflowsAndComposites': lint(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT)}))
