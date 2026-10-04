import unittest
from types import SimpleNamespace

from native_ime_driver import run_native_ime


class Protocol:
    def __init__(self):
        self.calls = []
        self.detached = False

    def send(self, method, arguments):
        self.calls.append((method, arguments))

    def detach(self):
        self.detached = True


class NativeImeDriverTests(unittest.TestCase):
    def test_driver_requests_real_composition_and_returns_the_fixture_observation(self):
        protocol = Protocol()
        phases = []
        def evaluate(script):
            phases.append(script)
            return {'focused': True, 'inputTag': 'INPUT'} if "'focus'" in script else {'passed': True, 'events': ['observed']}
        page = SimpleNamespace(evaluate=evaluate, context=SimpleNamespace(new_cdp_session=lambda target: protocol))
        browser = SimpleNamespace(browser_type=SimpleNamespace(name='chromium'))
        result = run_native_ime(page, browser)
        self.assertEqual(result, {'passed': True, 'events': ['observed']})
        self.assertEqual([method for method, _ in protocol.calls],
                         ['Input.imeSetComposition', 'Input.imeSetComposition', 'Input.insertText'])
        self.assertEqual(protocol.calls[-1][1]['text'], '漢字')
        self.assertTrue(protocol.detached)
        self.assertFalse(any('dispatchEvent' in script for script in phases))

    def test_unavailable_native_protocol_is_an_incomplete_qualification(self):
        browser = SimpleNamespace(browser_type=SimpleNamespace(name='webkit'))
        result = run_native_ime(None, browser)
        self.assertFalse(result['passed'])
        self.assertEqual(result['status'], 'incomplete-native-ime')


if __name__ == '__main__':
    unittest.main()
