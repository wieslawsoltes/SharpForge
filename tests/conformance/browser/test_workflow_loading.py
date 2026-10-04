"""Driver contracts only; these tests do not claim actual browser qualification."""
from pathlib import Path
import hashlib
import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from conformance.browser import launch, workflow_loading
import browser_vs_workflows_test as workflows


CSP = "script-src 'self' 'sha256-fixture'; object-src 'none'"


def fixture_page():
    page = MagicMock()
    def navigate(url, **options):
        page.url = url
    page.goto.side_effect = navigate
    page.locator.return_value.count.return_value = 1
    page.locator.return_value.get_attribute.return_value = CSP
    page.evaluate.return_value = True
    return page


class WorkflowLoadingContracts(unittest.TestCase):
    def test_file_navigation_uses_exact_artifact_uri_policy_and_startup(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'standalone with spaces.html'
            artifact.write_bytes(b'fixture artifact identity')
            page, observed = fixture_page(), {}
            with patch.dict(os.environ, {'SHARPFORGE_STANDALONE_PATH': str(artifact), 'SHARPFORGE_IN_MEMORY': '0'}), \
                    patch.object(workflow_loading, 'wait_condition') as wait, \
                    patch.object(workflow_loading, 'complete_startup') as startup:
                workflow_loading.load_workflow(page, 'file', observed)
            page.goto.assert_called_once_with(artifact.as_uri(), wait_until='domcontentloaded')
            page.set_content.assert_not_called()
            startup.assert_called_once_with(page)
            wait.assert_called_once()
            self.assertEqual(observed['mode'], 'file')
            self.assertTrue(observed['offline'])
            self.assertEqual(observed['policy'], {'transport': 'meta', 'value': CSP})
            self.assertEqual(observed['artifactSha256'], hashlib.sha256(artifact.read_bytes()).hexdigest())

    def test_relative_artifact_is_resolved_from_repository_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bundle.html').touch()
            with patch.object(workflow_loading, 'ROOT', root), \
                    patch.dict(os.environ, {'SHARPFORGE_STANDALONE_PATH': 'bundle.html'}):
                self.assertEqual(workflow_loading.standalone_path(), root / 'bundle.html')
            with patch.dict(os.environ, {'SHARPFORGE_STANDALONE_PATH': str(root / 'missing.html')}):
                with self.assertRaisesRegex(FileNotFoundError, 'Build the standalone artifact'):
                    workflow_loading.standalone_path()

    def test_file_rejects_missing_or_weakened_production_policy_and_redirect(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'bundle.html'
            artifact.touch()
            cases = [('missing', 'metadata'), ('unsafe', 'unsafe-eval'), ('redirect', 'left the requested file URL')]
            for kind, message in cases:
                with self.subTest(kind=kind):
                    page = fixture_page()
                    if kind == 'missing':
                        page.locator.return_value.count.return_value = 0
                    elif kind == 'unsafe':
                        page.locator.return_value.get_attribute.return_value = "script-src 'self' 'unsafe-eval'; object-src 'none'"
                    else:
                        page.goto.side_effect = lambda *args, **kwargs: setattr(page, 'url', 'about:blank')
                    with patch.dict(os.environ, {'SHARPFORGE_STANDALONE_PATH': str(artifact), 'SHARPFORGE_IN_MEMORY': '0'}), \
                            self.assertRaisesRegex(AssertionError, message):
                        workflow_loading.load_workflow(page, 'file', {})

    def test_packaging_modes_never_substitute_in_memory_loading(self):
        with patch.dict(os.environ, {'SHARPFORGE_IN_MEMORY': '0'}):
            for mode in ('http', 'file'):
                self.assertEqual(workflow_loading.workflow_mode(mode), mode)
            with self.assertRaisesRegex(ValueError, 'Workflow mode'):
                workflow_loading.workflow_mode('injection')
        with patch.dict(os.environ, {'SHARPFORGE_IN_MEMORY': '1'}):
            for mode in ('http', 'file'):
                with self.assertRaisesRegex(ValueError, 'real HTTP or file navigation'):
                    workflow_loading.workflow_mode(mode)

    def test_http_uses_existing_production_loader(self):
        page, observed = fixture_page(), {}
        page.url = 'http://127.0.0.1:8000/'
        with patch.dict(os.environ, {'SHARPFORGE_IN_MEMORY': '0'}), \
                patch.object(workflow_loading, 'load_application') as load:
            workflow_loading.load_workflow(page, 'http', observed)
        load.assert_called_once_with(page)
        self.assertEqual(observed, {'mode': 'http', 'url': page.url, 'offline': False})
        page.goto.assert_not_called()

    def test_offline_records_failed_http_attempts_without_blocking_embedded_urls(self):
        context, attempts = MagicMock(), []
        workflow_loading.observe_offline_requests(context, attempts)
        event, callback = context.on.call_args.args
        self.assertEqual(event, 'request')
        for url in ('file:///bundle.html', 'blob:null/example', 'https://example.invalid/tool.js', 'http://localhost/tool.js'):
            request = MagicMock()
            request.url = url
            callback(request)
        self.assertEqual(attempts, ['https://example.invalid/tool.js', 'http://localhost/tool.js'])
        pattern, route_handler = context.route.call_args.args
        self.assertTrue(pattern.match(attempts[0]))
        self.assertIsNone(pattern.match('file:///bundle.html'))
        route = MagicMock()
        route_handler(route)
        route.abort.assert_called_once_with('internetdisconnected')

    def test_session_metadata_preserves_separate_file_and_http_identities(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(os.environ, {'SHARPFORGE_RESULTS_DIR': directory, 'SHARPFORGE_IN_MEMORY': '0'}):
            for suite, mode in [('workflow_static', 'http'), ('workflow_standalone', 'file')]:
                browser = MagicMock()
                browser.version = 'fixture-browser'
                session = launch.BrowserSession(browser, suite, engine='firefox', mode=mode)
                session.close()
                value = json.loads((Path(directory) / suite / 'session.json').read_text(encoding='utf8'))
                self.assertEqual((value['suite'], value['mode'], value['engine']), (suite, mode, 'firefox'))

    def test_workflow_failure_report_has_wrapper_identity_and_distinct_filename(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(os.environ, {'SHARPFORGE_RESULTS_DIR': directory, 'SHARPFORGE_IN_MEMORY': '0'}), \
                patch.object(workflows, 'sync_playwright'), patch.object(workflows, 'launch_browser') as browser, \
                patch.object(workflows, 'exercise', side_effect=AssertionError('fixture failure')):
            browser.return_value.__enter__.return_value.version = 'fixture-browser'
            with self.assertRaisesRegex(AssertionError, 'fixture failure'):
                workflows.run(mode='file', suite='wrapper_standalone.py')
            self.assertEqual(browser.call_args.kwargs['mode'], 'file')
            report = json.loads((Path(directory) / 'vs-workflow-standalone-results.json').read_text(encoding='utf8'))
            self.assertEqual(report['suite'], 'wrapper_standalone')
            self.assertFalse(report['passed'])
            self.assertEqual(report['failure']['message'], 'fixture failure')
            self.assertFalse((Path(directory) / 'vs-workflow-results.json').exists())


if __name__ == '__main__':
    unittest.main()
