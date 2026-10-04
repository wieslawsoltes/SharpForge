import base64
import unittest

from inline_reference import canvas_result


class InlineReferenceTests(unittest.TestCase):
    def fixture(self):
        pixels = bytes([0, 0, 0, 255])
        packet = {'kind': 'canvas2d-numeric-outline', 'provider': 'harfbuzz', 'glyphAccess': 'numeric-glyphs',
                  'width': 1, 'height': 1, 'alphaMode': 'premultiplied', 'rgba': base64.b64encode(pixels).decode()}
        fixture = {'canvasReference': True, 'tolerance': {'maxChannel': 0, 'meanChannel': 0, 'differentPixelFraction': 0}}
        return pixels, packet, fixture

    def test_canvas_reference_is_explicit_and_does_not_qualify_native_parity(self):
        pixels, packet, fixture = self.fixture()
        result, difference, reference = canvas_result(packet, fixture, pixels, (1, 1))
        self.assertTrue(result['passed'])
        self.assertIn('native WinUI parity remains separate', result['scope'])
        self.assertEqual(reference, pixels)
        self.assertEqual(len(difference), len(pixels))
        changed = bytes([255, 255, 255, 255])
        result, _, _ = canvas_result(packet, fixture, changed, (1, 1))
        self.assertFalse(result['passed'])

    def test_required_missing_provider_and_malformed_packets_fail(self):
        pixels, packet, fixture = self.fixture()
        result, _, _ = canvas_result(None, fixture, pixels, (1, 1))
        self.assertFalse(result['passed'])
        for edit in ({'provider': 'mock'}, {'width': 2}, {'rgba': 'broken'}, {'alphaMode': 'straight'}):
            with self.assertRaises(ValueError):
                canvas_result({**packet, **edit}, fixture, pixels, (1, 1))

    def test_native_path_profile_requires_the_exact_independent_provider(self):
        pixels, packet, fixture = self.fixture()
        path_packet = {**packet, 'kind': 'canvas2d-native-path', 'provider': 'browser-native-svg',
                       'glyphAccess': 'not-applicable'}
        result, _, reference = canvas_result(path_packet, fixture, pixels, (1, 1))
        self.assertTrue(result['passed'])
        self.assertEqual(reference, pixels)
        self.assertEqual(result['provider'], 'browser-native-svg')
        for edit in ({'provider': 'harfbuzz'}, {'glyphAccess': 'numeric-glyphs'}, {'kind': 'canvas2d'}):
            with self.assertRaises(ValueError):
                canvas_result({**path_packet, **edit}, fixture, pixels, (1, 1))


if __name__ == '__main__':
    unittest.main()
