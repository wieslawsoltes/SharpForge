"""Offline policy/schema and real pip hash-enforcement regressions; no release signing is simulated."""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[3]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/conformance/supply' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


workflows = load('supply_workflows', 'workflow-lint.py')
sbom = load('supply_sbom', 'validate-sbom.py')
lock = load('supply_lock', 'lock-python.py')


class SupplyToolingTests(unittest.TestCase):
    def test_workflow_pin_and_script_injection_semantics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            good = 'permissions: {contents: read}\non: pull_request\njobs:\n  test:\n    steps:\n'
            good += '      - uses: actions/checkout@' + 'a' * 40 + '\n      - run: echo "$TITLE"\n'
            workflows.lint_document(workflows.parse_workflow(good), 'fixture.yml', root, {})
            for bad in [good.replace('a' * 40, 'v4'),
                        good.replace('echo "$TITLE"', 'echo "${{ github.event.pull_request.title }}"'),
                        good.replace('contents: read', 'contents: write'),
                        good.replace('on: pull_request', 'on: pull_request_target')]:
                with self.assertRaises(ValueError):
                    workflows.lint_document(workflows.parse_workflow(bad), 'fixture.yml', root, {})
            flow = 'permissions: {contents: read}\n"on": pull_request\njobs: {x: {steps: [{"uses": "a/b@v1"}]}}'
            with self.assertRaises(ValueError):
                workflows.lint_document(workflows.parse_workflow(flow), 'fixture.yml', root, {})

    def test_yaml_duplicate_alias_and_expression_boundaries(self):
        for text in ['jobs: {}\njobs: {}', 'x: &alias {a: 1}\ny: *alias', 'x' * (2 * 1024 * 1024 + 1)]:
            with self.assertRaises(ValueError):
                workflows.parse_workflow(text)
        workflows.check_script('node tests/${{ matrix.suite }}.js', {'suite': ['valid_name', 'other']})
        with self.assertRaises(ValueError):
            workflows.check_script('echo ${{ matrix.suite }}', '${{ fromJSON(github.event.issue.body) }}')
        with self.assertRaises(ValueError):
            workflows.check_reference('docker://image:latest', ROOT)
        workflows.check_reference('docker://image@sha256:' + 'a' * 64, ROOT)
        with self.assertRaises(ValueError):
            workflows.check_script('echo ${{ matrix.suite }}', {'suite': ['safe'], 'include': [{'suite': '$(unsafe)'}]})

    def test_official_cyclonedx_schema_rejects_invalid_license_hash_and_type(self):
        document = {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'version': 1,
                    'components': [{'type': 'library', 'bom-ref': 'owned-fixture', 'name': 'owned-fixture',
                                    'licenses': [{'license': {'id': 'MIT'}}],
                                    'hashes': [{'alg': 'SHA-256', 'content': 'a' * 64}]}]}
        self.assertEqual(sbom.validate(document), 1)
        for field, value in [('type', 'not-a-type'), ('licenses', [{'license': {'id': 'Not-An-SPDX-License'}}]),
                             ('hashes', [{'alg': 'SHA-256', 'content': 'short'}])]:
            altered = json.loads(json.dumps(document))
            altered['components'][0][field] = value
            with self.assertRaises(Exception):
                sbom.validate(altered)
        document['components'].append({**document['components'][0], 'name': 'different owned fixture'})
        with self.assertRaises(ValueError):
            sbom.validate(document)

    def test_locked_dependencies_match_reviewed_metadata(self):
        metadata = json.loads((ROOT / 'planning/qualification/supply/python-lock.json').read_text())
        self.assertEqual(lock.render_lock(metadata['packages']), (ROOT / 'tests/requirements.txt').read_text())
        self.assertIn('playwright', [package['name'] for package in metadata['packages']])
        self.assertGreaterEqual(len(metadata['packages']), 10)
        self.assertTrue(set(metadata['roots']).issubset(
            {package['name'] + '==' + package['version'] for package in metadata['packages']}))

    def test_lock_roots_follow_requested_resolution_versions(self):
        resolution = {'install': [
            {'requested': True, 'metadata': {'name': 'playwright', 'version': '1.63.0'}},
            {'requested': False, 'metadata': {'name': 'pyee', 'version': '13.0.1'}},
            {'requested': True, 'metadata': {'name': 'PyYAML', 'version': '6.0.3'}},
        ]}
        self.assertEqual(lock.resolved_roots(resolution), ['playwright==1.63.0', 'PyYAML==6.0.3'])

    def test_release_asset_and_permission_ordering(self):
        release = workflows.parse_workflow((ROOT / '.github/workflows/release.yml').read_text())
        build, publish = release['jobs']['build'], release['jobs']['publish']
        self.assertEqual(build['permissions']['contents'], 'read')
        self.assertEqual(publish['permissions']['contents'], 'write')
        self.assertEqual(publish['needs'], 'draft')
        self.assertEqual(release['jobs']['draft']['needs'], 'build')
        self.assertEqual(publish['environment']['name'], 'release')
        steps = build['steps']
        attest = next(index for index, step in enumerate(steps) if step.get('uses', '').startswith('actions/attest@'))
        prior = '\n'.join(step.get('run', '') for step in steps[:attest])
        self.assertIn('seal.js verify browser', prior)
        self.assertIn('seal.js verify packages', prior)
        self.assertIn('validate-sbom.py', prior)
        self.assertIn('node scripts/conformance/repro/package-release.js', prior)
        self.assertIn('node scripts/conformance/source-manifest.js --verify', prior.splitlines())
        self.assertNotIn('--verify-payloads', prior)
        self.assertNotIn('browser-archive.py', prior)
        subjects = steps[attest]['with']['subject-path']
        for name in ['*.tgz', 'SharpForge-browser.zip', 'SharpForge-standalone.html', 'SBOM.cdx.json']:
            self.assertIn(name, subjects)
        self.assertTrue(any('attestation.js verify' in step.get('run', '') for step in steps[attest + 1:]))
        publish_scripts = '\n'.join(step.get('run', '') for step in publish['steps'])
        self.assertLess(publish_scripts.index('source-manifest.js --verify-payloads'),
                        publish_scripts.index('release.js publish --execute'))
        publication = (ROOT / 'scripts/conformance/release-policy/release.js').read_text()
        self.assertLess(publication.index('await verifyReleaseProof'), publication.index("method: 'PATCH'"))
        self.assertIn("'--draft'", publication)
        self.assertIn("requireApproval: mode === 'publish'", publication)
        self.assertIn('node scripts/conformance/source-manifest.js --verify-payloads', publish_scripts.splitlines())
        self.assertNotIn('node scripts/conformance/source-manifest.js --verify', publish_scripts.splitlines())

    def test_qualified_producers_use_reviewed_toolchain_without_expanding_core(self):
        workflow = workflows.parse_workflow((ROOT / '.github/workflows/ci.yml').read_text())
        toolchain = json.loads((ROOT / 'planning/qualification/repro/toolchain.json').read_text())
        core = workflow['jobs']['core']
        self.assertNotIn('if', core)
        self.assertNotIn('strategy', core)
        for command in ['npm run check', 'npm test', 'npm run build']:
            self.assertEqual(sum(step.get('run') == command for step in core['steps']), 1)
        for name in ['build', 'packages']:
            job = workflow['jobs'][name]
            self.assertIn("'full-ci'", job['if'])
            setup = next(step for step in job['steps'] if step.get('uses', '').startswith('actions/setup-node@'))
            self.assertEqual(setup['with']['node-version'], toolchain['node'])
            self.assertTrue(any('await assertToolchain(process.cwd())' in step.get('run', '') for step in job['steps']))

    def test_security_jobs_preserve_core_only_ordinary_prs(self):
        security = workflows.parse_workflow((ROOT / '.github/workflows/security.yml').read_text())
        self.assertEqual(set(security['on']), {'workflow_dispatch'})
        self.assertNotIn('pull_request_target', security['on'])
        self.assertEqual(security['defaults']['run']['shell'], 'bash')
        for job in security['jobs'].values():
            self.assertNotIn('if', job)
            self.assertEqual(job['strategy']['max-parallel'], 1)
        self.assertEqual(security['jobs']['codeql']['needs'], 'supply')
        languages = security['jobs']['codeql']['strategy']['matrix']['language']
        self.assertEqual(set(languages), {'javascript-typescript', 'python'})


    def test_release_policy_and_preview_jobs_keep_privilege_and_approval_boundaries(self):
        release = workflows.parse_workflow((ROOT / '.github/workflows/release.yml').read_text())
        self.assertEqual(release['jobs']['qualification']['uses'], './.github/workflows/ci.yml')
        self.assertEqual(release['jobs']['qualification']['needs'], 'policy')
        self.assertTrue(release['jobs']['qualification']['with']['qualification'])
        self.assertEqual(release['jobs']['build']['needs'], 'qualification')
        policy_scripts = '\n'.join(step.get('run', '') for step in release['jobs']['policy']['steps'])
        for script in ['release/version-check.js', 'release-policy/check-policy.js', 'release-policy/environment.js']:
            self.assertIn(script, policy_scripts)
        self.assertIn('environment:', (ROOT / '.github/workflows/release.yml').read_text())
        self.assertNotIn('always()', release['jobs']['publish'].get('if', ''))
        watcher = workflows.parse_workflow((ROOT / '.github/workflows/spec-watch.yml').read_text())
        self.assertEqual(set(watcher['on']), {'schedule', 'workflow_dispatch'})
        self.assertFalse(watcher['concurrency']['cancel-in-progress'])
        self.assertEqual(watcher['jobs']['watch']['permissions']['issues'], 'write')
        preview = workflows.parse_workflow((ROOT / '.github/workflows/preview.yml').read_text())
        self.assertEqual(set(preview['on']), {'workflow_dispatch'})
        self.assertNotIn('pages', preview['permissions'])
        self.assertTrue(all(access == 'read' for access in preview['permissions'].values()))
        core = workflows.parse_workflow((ROOT / '.github/workflows/ci.yml').read_text())['jobs']['core']
        uploads = [step for step in core['steps'] if step.get('name') == 'Upload PR preview without a second build or deployment']
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0]['if'], "github.event_name == 'pull_request'")
        self.assertIn('artifacts/preview.json', uploads[0]['with']['path'])
        self.assertEqual(sum(step.get('run') == 'npm run build' for step in core['steps']), 1)

    def test_browser_archive_requires_real_bounded_inputs(self):
        def create_archive(root):
            command = ['node', str(ROOT / 'scripts/conformance/repro/package-release.js'),
                       '--root', str(root), '--epoch', '1767225601']
            return subprocess.run(command, check=True, capture_output=True, text=True, timeout=30)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'dist').mkdir()
            (root / 'artifacts').mkdir()
            with self.assertRaises(subprocess.CalledProcessError):
                create_archive(root)
            (root / 'dist/owned.js').write_text('owned fixture')
            create_archive(root)
            with ZipFile(root / 'artifacts/SharpForge-browser.zip') as payload:
                self.assertEqual(payload.namelist(), ['owned.js'])
                self.assertEqual(payload.read('owned.js'), b'owned fixture')
            with (root / 'dist/large').open('wb') as payload:
                payload.truncate(64 * 1024 * 1024 + 1)
            with self.assertRaises(subprocess.CalledProcessError):
                create_archive(root)

    def test_real_pip_rejects_tampered_hash_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wheel = root / 'supply_hash_probe-1.0-py3-none-any.whl'
            with ZipFile(wheel, 'w') as archive:
                archive.writestr('supply_hash_probe.py', 'VALUE = 42\n')
                archive.writestr('supply_hash_probe-1.0.dist-info/METADATA',
                                 'Metadata-Version: 2.1\nName: supply-hash-probe\nVersion: 1.0\n')
                archive.writestr('supply_hash_probe-1.0.dist-info/WHEEL',
                                 'Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
                archive.writestr('supply_hash_probe-1.0.dist-info/RECORD', '')
            for valid in [True, False]:
                digest = hashlib.sha256(wheel.read_bytes()).hexdigest() if valid else '0' * 64
                requirements = root / 'requirements.txt'
                requirements.write_text(str(wheel) + ' --hash=sha256:' + digest + '\n')
                command = [sys.executable, '-m', 'pip', 'install', '--no-index', '--no-deps', '--require-hashes',
                           '--target', str(root / str(valid)), '-r', str(requirements)]
                result = subprocess.run(command, capture_output=True, text=True, timeout=30)
                if valid:
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('DO NOT MATCH THE HASHES', result.stderr)


if __name__ == '__main__':
    unittest.main()
