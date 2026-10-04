from pathlib import Path
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('qualification_launch', Path(__file__).with_name('launch.py'))
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


class LauncherContracts(unittest.TestCase):
    def test_cooperative_cancel_preserves_driver_until_context_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            cancel_file = Path(directory) / 'cancel.request'
            with patch.dict(os.environ, {'SHARPFORGE_RESULTS_DIR': directory, 'SHARPFORGE_CANCEL_FILE': str(cancel_file)}):
                browser = MagicMock()
                browser.version = 'unit-test-browser'
                session = launch.BrowserSession(browser, 'cancelled')
                page = session.new_page()
                page.wait_for_timeout(1)
                cancel_file.write_text('cancel', encoding='utf-8')
                with self.assertRaisesRegex(KeyboardInterrupt, 'cooperative request'):
                    page.wait_for_timeout(1)
                browser.close.assert_not_called()
                session.close(KeyboardInterrupt('cooperative request'))
                browser.close.assert_called_once()

    def test_managed_browser_default_and_empty_override(self):
        self.assertEqual(launch.launch_options({}), {'headless': True})
        self.assertEqual(launch.launch_options({'CHROMIUM_EXECUTABLE': '  '}), {'headless': True})

    def test_native_rtc_loopback_is_explicit_and_recorded(self):
        options = launch.launch_options({}, engine='chromium', rtc_loopback=True)
        self.assertEqual(options, {'headless': True, 'args': ['--allow-loopback-in-peer-connection']})
        self.assertNotIn('args', launch.launch_options({}, engine='chromium'))
        with self.assertRaisesRegex(ValueError, 'only for Chromium'):
            launch.launch_options({}, engine='firefox', rtc_loopback=True)
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'SHARPFORGE_RESULTS_DIR': directory}):
            browser = MagicMock()
            browser.version = 'unit-test-browser'
            session = launch.BrowserSession(browser, 'rtc-loopback', engine='chromium', configuration=options)
            session.close()
            report = json.loads((Path(directory) / 'rtc-loopback/session.json').read_text(encoding='utf-8'))
            self.assertEqual(report['launchArguments'], options['args'])

    def test_override_validates_file_and_preserves_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'chromium with spaces'
            path.touch()
            self.assertEqual(launch.launch_options({'CHROMIUM_EXECUTABLE': str(path)})['executable_path'], str(path.resolve()))
            for invalid in (directory, str(path) + '-missing'):
                with self.assertRaisesRegex(ValueError, 'not a file'):
                    launch.launch_options({'CHROMIUM_EXECUTABLE': invalid})

    def test_disposal_is_idempotent_and_success_discards_trace(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'SHARPFORGE_RESULTS_DIR': directory}):
            browser = MagicMock()
            browser.version = 'unit-test-browser'
            session = launch.BrowserSession(browser, 'unit')
            session.new_page()
            session.close()
            session.close()
            browser.close.assert_called_once()
            browser.new_context.return_value.tracing.stop.assert_called_once_with(path=None)

    def test_failure_retains_trace_and_screenshot(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'SHARPFORGE_RESULTS_DIR': directory}):
            browser = MagicMock()
            browser.version = 'unit-test-browser'
            context = browser.new_context.return_value
            page = MagicMock()
            context.pages = [page]
            session = launch.BrowserSession(browser, 'failed')
            session.new_page()
            session.close(AssertionError('fixture failure'))
            self.assertEqual(Path(context.tracing.stop.call_args.kwargs['path']).name, 'trace.zip')
            self.assertEqual(Path(page.screenshot.call_args.kwargs['path']).name, 'screenshot.png')
            self.assertIn('fixture failure', (Path(directory) / 'failed/console.log').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
