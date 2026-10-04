"""Driver evidence contracts; no browser is launched by these tests."""
import os
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from conformance.browser import workflow_loading
from conformance.browser.workflow_diagnostics import capture_startup
from conformance.browser.test_workflow_loading import fixture_page


class WorkflowDiagnostics(unittest.TestCase):
    def test_exported_javascript_sanitizes_native_url_details_and_keeps_file_http_identity(self):
        page = MagicMock()
        def evaluate(source):
            fixture = '''import {readFileSync} from 'node:fs';
                import {runInNewContext} from 'node:vm';
                const source = readFileSync(0, 'utf8');
                const link = 'http://user:password@127.0.0.1:3000/app?cap=hidden#private';
                const error = {message:'Loading '+link, stack:'at '+link, cause:{message:'at '+link, stack:'at '+link}};
                const owners = {list:()=>[{id:'project', worker:{failed:true, generation:1, lastError:error}}]};
                const value = runInNewContext('('+source+')()', {URL,
                    location:{href:link, origin:'http://127.0.0.1:3000'},
                    window:{sharpforge:{workbenchServices:{builds:owners, sessions:owners}}},
                    document:{querySelector:()=>({textContent:'Loading '+link})}});
                process.stdout.write(JSON.stringify(value));'''
            result = subprocess.run(['node', '--input-type=module', '-e', fixture], input=source,
                                    text=True, capture_output=True, check=True, timeout=10)
            return json.loads(result.stdout)
        page.evaluate.side_effect = evaluate
        observed = {}
        capture_startup(page, observed)
        self.assertNotIn('startupDiagnosticError', observed)
        self.assertEqual(observed['startup']['url'], 'http://127.0.0.1:3000/app')
        self.assertNotRegex(json.dumps(observed), 'password|hidden|private|user:')
        self.assertEqual(observed['startup']['compiler'][0]['generation'], 1)

    def test_diagnostics_preserve_observation_and_bounded_collection_failures(self):
        page, observation = MagicMock(), {'mode': 'file'}
        page.evaluate.return_value = {'url': 'file:///app.html', 'compiler': [{'failed': True}]}
        capture_startup(page, observation)
        self.assertEqual(observation['startup'], page.evaluate.return_value)
        self.assertEqual(observation['mode'], 'file')
        page.evaluate.side_effect = RuntimeError('x' * 5000)
        capture_startup(page, observation)
        self.assertEqual(observation['startupDiagnosticError'], 'RuntimeError: startup diagnostic collection failed')

    def test_file_timeout_retains_native_worker_evidence_and_original_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'bundle.html'
            artifact.write_bytes(b'file fixture')
            page, observation = fixture_page(), {}
            page.evaluate.side_effect = [True, {'url': artifact.as_uri(), 'compiler': [
                {'failed': True, 'error': {'worker': {'type': 'classic', 'originalMessage': ''}}}]}]
            failure = TimeoutError('metrics unavailable')
            with patch.dict(os.environ, {'SHARPFORGE_STANDALONE_PATH': str(artifact), 'SHARPFORGE_IN_MEMORY': '0'}), \
                    patch.object(workflow_loading, 'wait_condition', side_effect=failure), \
                    patch.object(workflow_loading, 'complete_startup') as startup:
                with self.assertRaises(TimeoutError) as raised:
                    workflow_loading.load_workflow(page, 'file', observation)
            self.assertIs(raised.exception, failure)
            startup.assert_not_called()
            self.assertEqual(observation['startup']['compiler'][0]['error']['worker']['originalMessage'], '')

    def test_http_timeout_keeps_http_attribution_and_original_failure(self):
        page, observation = MagicMock(), {}
        page.evaluate.return_value = {'url': 'http://127.0.0.1:3000/', 'compiler': []}
        failure = TimeoutError('HTTP startup unavailable')
        with patch.dict(os.environ, {'SHARPFORGE_IN_MEMORY': '0'}), \
                patch.object(workflow_loading, 'load_application', side_effect=failure):
            with self.assertRaises(TimeoutError) as raised:
                workflow_loading.load_workflow(page, 'http', observation)
        self.assertIs(raised.exception, failure)
        self.assertEqual(observation['startup']['url'], 'http://127.0.0.1:3000/')


if __name__ == '__main__':
    unittest.main()
