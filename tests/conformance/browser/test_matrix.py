from pathlib import Path
import importlib.util
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests'))
from conformance.browser.launch import launch_options,selected_engine
from conformance.browser.csp_monitor import CspMonitor,CspViolation
from conformance.browser.matrix_common import policy
from conformance.browser.run_matrix import bounded

class MatrixContracts(unittest.TestCase):
    def test_engine_options_and_unknown_rejected(self):
        for engine in ('chromium','firefox','webkit'):
            self.assertEqual(selected_engine({'SHARPFORGE_BROWSER_ENGINE':engine}),engine)
            self.assertEqual(launch_options({},engine),{'headless':True})
            with self.assertRaises(ValueError):launch_options({engine.upper()+'_EXECUTABLE':'/missing'},engine)
        with self.assertRaises(ValueError):selected_engine({'SHARPFORGE_BROWSER_ENGINE':'safari'})
    def test_csp_monitor_positive_negative_and_report_only(self):
        monitor=CspMonitor();monitor.assert_clean()
        for value in [{'source':'event','disposition':'enforce'},{'source':'event','disposition':'report'}]:
            monitor.events=[value]
            with self.assertRaises(CspViolation):monitor.assert_clean()
    def test_missing_or_unsafe_policy_fails(self):
        valid="script-src 'self' 'wasm-unsafe-eval'; object-src 'none'"
        self.assertEqual(policy({'content-security-policy':valid})['transport'],'header')
        self.assertEqual(policy({},valid)['transport'],'meta')
        for invalid in ['',"script-src 'self' 'unsafe-eval'; object-src 'none'","script-src 'self' 'unsafe-inline'; object-src 'none'","script-src 'self'"]:
            with self.assertRaises(AssertionError):policy({'content-security-policy':invalid})
    def test_child_timeout_reaped_and_nonzero_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            result=bounded([sys.executable,'-c','import time;time.sleep(30)'],.05,Path(directory)/'hang')
            self.assertTrue(result['timedOut']);self.assertEqual(result['exitCode'],124)
            result=bounded([sys.executable,'-c','raise SystemExit(7)'],5,Path(directory)/'failure')
            self.assertEqual(result['exitCode'],7);self.assertFalse(result['timedOut'])
if __name__=='__main__':unittest.main()
