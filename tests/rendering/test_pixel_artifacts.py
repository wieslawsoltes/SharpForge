import gzip
import json
import tempfile
import unittest
from pathlib import Path

from pixel_artifacts import compare_pixels, golden_result, native_result, png_bytes
from png_pixels import decode_png, screenshot_pixels, unfilter


class PixelArtifactsTests(unittest.TestCase):
    def test_round_trip_preserves_premultiplied_alpha_and_screenshot_crop(self):
        pixels = bytes([128, 0, 0, 128, 0, 255, 0, 255])
        encoded = png_bytes(2, 1, pixels)
        self.assertEqual(decode_png(encoded), (2, 1, pixels))
        size, cropped = screenshot_pixels(encoded, {'x': 1, 'y': 0, 'width': 1, 'height': 1}, {'width': 2, 'height': 1})
        self.assertEqual((size, cropped), ((1, 1), pixels[4:]))
        with self.assertRaises(ValueError):
            screenshot_pixels(encoded, {'x': 2, 'y': 0, 'width': 1, 'height': 1}, {'width': 2, 'height': 1})

    def test_all_png_filters_and_malformed_input(self):
        for kind in range(5):
            self.assertEqual(unfilter(bytes([kind, 10, 20, 30, 40]), 1, 1, 4), bytes([10, 20, 30, 40]))
        self.assertEqual(unfilter(bytes([1, 1, 2, 3, 4, 9, 18, 27, 36]), 2, 1, 4), bytes([1, 2, 3, 4, 10, 20, 30, 40]))
        self.assertEqual(unfilter(bytes([2, 10, 20, 30, 40, 2, 1, 2, 3, 4]), 1, 2, 4), bytes([10, 20, 30, 40, 11, 22, 33, 44]))
        encoded = bytearray(png_bytes(1, 1, bytes([1, 2, 3, 255])))
        encoded[20] ^= 1
        with self.assertRaisesRegex(ValueError, 'checksum'):
            decode_png(bytes(encoded))
        with self.assertRaises(ValueError):
            png_bytes(-1, -1, bytes(4))
        with self.assertRaises(ValueError):
            unfilter(bytes([5, 0, 0, 0, 0]), 1, 1, 4)

    def test_comparison_rejects_nonfinite_tolerances_and_requires_explicit_update(self):
        fixture = {'id': 'fixture', 'tolerance': {'maxChannel': 2, 'meanChannel': 1, 'differentPixelFraction': 0}}
        pixels = bytes([0, 0, 0, 255])
        metadata = {'actualBackend': 'webgpu', 'actualTier': 'software', 'captureMode': 'retained-readback'}
        with tempfile.TemporaryDirectory() as directory:
            missing, _ = golden_result(directory, fixture, pixels, (1, 1), metadata)
            self.assertFalse(missing['passed'])
            self.assertEqual(list(Path(directory).iterdir()), [])
            golden_result(directory, fixture, pixels, (1, 1), metadata, update=True)
            actual, _ = golden_result(directory, fixture, pixels, (1, 1), metadata)
            self.assertTrue(actual['passed'])
            native, _ = native_result(None, fixture, pixels, (1, 1), windows_app_sdk='1.8.260921001')
            self.assertEqual(native['status'], 'pending-native')
            with self.assertRaisesRegex(ValueError, 'provenance'):
                native_result(directory, fixture, pixels, (1, 1), windows_app_sdk='1.8.260921001')
        invalid = {**fixture['tolerance'], 'meanChannel': float('nan')}
        with self.assertRaises(ValueError):
            compare_pixels(pixels, pixels, invalid)

    def test_native_provider_requires_sdk_tool_and_capture_provenance(self):
        fixture = {'id': 'native', 'tolerance': {'maxChannel': 0, 'meanChannel': 0, 'differentPixelFraction': 0}}
        pixels = bytes([0, 0, 0, 255])
        metadata = {'dimensions': [1, 1], 'alphaMode': 'premultiplied', 'referenceKind': 'native-winui', 'tool': 'WinUI',
                    'windowsAppSdkVersion': '1.8.260921001', 'toolVersion': 'oracle-test', 'captureCommand': 'capture native',
                    'operatingSystem': 'test-provider'}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'native.rgba.gz').write_bytes(gzip.compress(pixels))
            (root / 'native.json').write_text(json.dumps(metadata))
            result, _ = native_result(root, fixture, pixels, (1, 1), windows_app_sdk='1.8.260921001')
            self.assertTrue(result['passed'])
            with self.assertRaisesRegex(ValueError, 'SDK'):
                native_result(root, fixture, pixels, (1, 1), windows_app_sdk='1.7')


if __name__ == '__main__':
    unittest.main()
