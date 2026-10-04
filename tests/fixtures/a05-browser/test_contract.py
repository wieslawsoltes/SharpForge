"""No browser is simulated here: test only the evidence validator's rejection contract."""
import tempfile
import unittest
from pathlib import Path

from qualify import expected_csp
from speedscope import assert_table, unpack_official


class EvidenceContract(unittest.TestCase):
    def setUp(self):
        self.expected = {'instructions': 42, 'methods': [
            {'name': 'Program::Main', 'total': 42, 'self': 30},
            {'name': 'Program::Twice', 'total': 12, 'self': 12}]}
        self.rows = [['42 (100%)', '30 (71.43%)', 'Program::Main'],
                     ['12 (28.57%)', '12 (28.57%)', 'Program::Twice']]

    def test_counts_are_read_from_cells_and_equal_recorded_instructions(self):
        result = assert_table(self.rows, self.expected)
        self.assertEqual(result['displayedSelfSum'], 42)

    def test_wrong_name_count_total_duplicate_or_missing_row_cannot_qualify(self):
        variants = [self.rows[:1], self.rows + self.rows[:1],
                    [self.rows[0], ['12 (28.57%)', '12 (28.57%)', 'Wrong']],
                    [['41 (100%)', '30 (71.43%)', 'Program::Main'], self.rows[1]],
                    [['42 (100%)', '29 (71.43%)', 'Program::Main'], self.rows[1]]]
        for rows in variants:
            with self.subTest(rows=rows), self.assertRaises(AssertionError):
                assert_table(rows, self.expected)
        with self.assertRaises(AssertionError):
            assert_table(self.rows, {**self.expected, 'instructions': 43})

    def test_no_download_substitution_can_supply_a_ui(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                unpack_official(b'<html>fake</html>', Path(directory))

    def test_only_expected_real_csp_events_can_qualify_denial(self):
        url = 'http://127.0.0.1:1234/denied.html'
        event = {'source': 'event', 'documentURI': url, 'directive': 'script-src',
                 'blockedURI': 'wasm-eval', 'disposition': 'enforce'}
        expected_csp([event], url)
        for changed in ({'documentURI': url + '/other'}, {'blockedURI': 'inline'},
                        {'directive': 'style-src'}, {'disposition': 'report'}):
            with self.subTest(changed=changed), self.assertRaises(AssertionError):
                expected_csp([{**event, **changed}], url)
        with self.assertRaises(AssertionError):
            expected_csp([], url)


    def test_eventless_webkit_requires_independent_native_allowed_and_denied_proof(self):
        url = 'http://127.0.0.1:1234/denied.html'
        allowed = {'moduleHex': '0061736d01000000', 'compiled': True, 'nativeModule': True}
        rejected = {'moduleHex': allowed['moduleHex'], 'compiled': False, 'error': {
            'name': 'CompileError', 'nativeCompileError': True,
            'message': "Refused to create a WebAssembly object because of Content Security Policy"}}
        result = expected_csp([], url, engine='webkit', probe=rejected, allowed_probe=allowed)
        self.assertEqual(result, {'eventObserved': False, 'denialEvidence': 'native-csp-compile-rejection'})
        for engine in ('chromium', 'firefox', None):
            with self.subTest(engine=engine), self.assertRaises(AssertionError):
                expected_csp([], url, engine=engine, probe=rejected, allowed_probe=allowed)
        for control in (None, {**allowed, 'compiled': False}, {**allowed, 'nativeModule': False},
                        {**allowed, 'moduleHex': 'invalid'}):
            with self.subTest(control=control), self.assertRaises(AssertionError):
                expected_csp([], url, engine='webkit', probe=rejected, allowed_probe=control)
        failures = [{**rejected, 'compiled': True}, {**rejected, 'moduleHex': 'invalid'},
                    {**rejected, 'error': {**rejected['error'], 'nativeCompileError': False}},
                    {**rejected, 'error': {**rejected['error'], 'name': 'TypeError'}},
                    {**rejected, 'error': {**rejected['error'], 'message': 'WebAssembly: invalid module'}}]
        for probe in failures:
            with self.subTest(probe=probe), self.assertRaises(AssertionError):
                expected_csp([], url, engine='webkit', probe=probe, allowed_probe=allowed)
        with self.assertRaisesRegex(AssertionError, 'Unexpected CSP'):
            expected_csp([{'source': 'event', 'documentURI': url, 'directive': 'style-src',
                           'blockedURI': 'inline', 'disposition': 'enforce'}], url,
                         engine='webkit', probe=rejected, allowed_probe=allowed)


if __name__ == '__main__':
    unittest.main()
