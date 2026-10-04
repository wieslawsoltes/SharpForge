import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from native_fixture_matrix import native_fixtures
from native_provenance import validate_native_xaml, compare_shape_defaults


class NativeReferenceConsumerTests(unittest.TestCase):
    def observation(self):
        pixels = bytes([20, 30, 40, 128])
        fixture = {'scene': 'native-xaml', 'id': 'native-xaml-one', 'width': 1, 'height': 1,
                   'dpr': 1, 'theme': 'Light', 'xamlSha256': '1' * 64}
        environment = {'highContrast': False, 'textScaleFactor': 1, 'actualTheme': 'Light'}
        metadata = {'schemaVersion': 1, 'fixture': {key: fixture[key] for key in ('id', 'width', 'height', 'dpr', 'theme')},
                    'xamlSha256': fixture['xamlSha256'], 'captureMode': 'native-render-target-bitmap',
                    'rasterScaleMode': 'render-target-explicit-size', 'origin': 'top-left', 'colorSpace': 'srgb',
                    'inputHash': '2' * 64, 'pixelSha256': hashlib.sha256(pixels).hexdigest(), 'bgraSha256': '3' * 64,
                    'sourceRevision': '4' * 40, 'sourceDirty': False, 'captureCommand': ['node', 'capture.js'],
                    'operatingSystem': {'description': 'Microsoft Windows test observation', 'architecture': 'X64'},
                    'stabilityPolicy': {'consecutiveCaptures': 3, 'maximumRenderingTurns': 120, 'freshProcesses': 2},
                    'nativeEnvironment': {**environment, 'rasterizationScale': 1}}
        metadata['fixture']['focusTarget'] = None
        return metadata, fixture, pixels, environment

    def test_exact_native_identity_pixels_environment_and_stability_are_required(self):
        metadata, fixture, pixels, environment = self.observation()
        validate_native_xaml(metadata, fixture, pixels, environment)
        for change in ({'xamlSha256': '5' * 64}, {'pixelSha256': '6' * 64}, {'sourceRevision': 'bad'},
                       {'captureMode': 'browser-canvas'}, {'stabilityPolicy': {}}, {'sourceDirty': None}):
            with self.assertRaises(ValueError):
                validate_native_xaml({**metadata, **change}, fixture, pixels, environment)
        for key, value in [('theme', 'Dark'), ('dpr', 1.5), ('focusTarget', 'DifferentButton')]:
            changed = copy.deepcopy(metadata)
            changed['fixture'][key] = value
            with self.assertRaises(ValueError):
                validate_native_xaml(changed, fixture, pixels, environment)
        with self.assertRaises(ValueError):
            validate_native_xaml(metadata, fixture, pixels, {**environment, 'textScaleFactor': 1.25})

    def test_text_comparison_requires_observed_native_segoe_font_bytes(self):
        metadata, fixture, pixels, environment = self.observation()
        fixture['requiredFonts'] = ['Segoe UI']
        for files in (None, [], [{'name': 'segoeui.ttf', 'available': False}],
                      [{'name': 'segoeui.ttf', 'available': True, 'sha256': 'missing'}]):
            metadata['nativeEnvironment']['installedFontFiles'] = files
            with self.assertRaises(ValueError):
                validate_native_xaml(metadata, fixture, pixels, environment)
        metadata['nativeEnvironment']['installedFontFiles'] = [{'name': 'segoeui.ttf', 'available': True, 'sha256': 'a' * 64}]
        validate_native_xaml(metadata, fixture, pixels, environment)

    def test_catalog_uses_exact_xaml_bytes_and_does_not_turn_native_load_errors_into_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'fixtures').mkdir()
            xaml = b'<TextBlock xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Text="Native" />'
            (root / 'fixtures/text.xaml').write_bytes(xaml)
            row = {'id': 'native-xaml-text', 'file': 'text.xaml', 'width': 8, 'height': 8, 'dpr': 1.5,
                   'theme': 'Light', 'expected': 'pixels', 'xamlSha256': hashlib.sha256(xaml).hexdigest(),
                   'tolerance': {'maxChannel': 1, 'meanChannel': 0.5, 'differentPixelFraction': 0}}
            negative = {**row, 'id': 'native-xaml-negative', 'expected': 'load-error'}
            (root / 'fixtures.json').write_text(json.dumps({'schemaVersion': 1, 'captureProfile': 'static-xaml',
                                                         'fixtures': [row, negative]}))
            result = native_fixtures(root)
            self.assertEqual([item['id'] for item in result], ['native-xaml-text'])
            self.assertEqual(result[0]['requiredFonts'], ['Segoe UI'])
            self.assertTrue(result[0]['nativeReferenceRequired'])
            (root / 'fixtures/text.xaml').write_bytes(xaml + b' ')
            with self.assertRaises(ValueError):
                native_fixtures(root)

    def test_fresh_shape_defaults_compare_getters_dependency_values_and_local_presence(self):
        expected = [{'type': 'Microsoft.UI.Xaml.Shapes.' + name, 'strokeThickness': 1, 'stretch': 'None',
                     'strokeHasLocalValue': False, 'stretchHasLocalValue': False}
                    for name in ('Rectangle', 'Ellipse', 'Line', 'Path', 'Polygon', 'Polyline')]
        actual = [{**item, 'strokeViaGetValue': 1, 'stretchViaGetValue': 'None'} for item in expected]
        self.assertTrue(compare_shape_defaults(expected, actual)['passed'])
        actual[0]['strokeThickness'] = 0
        self.assertFalse(compare_shape_defaults(expected, actual)['passed'])
        self.assertEqual(compare_shape_defaults(None, actual)['status'], 'unavailable')
        self.assertFalse(compare_shape_defaults(expected, None)['passed'])


if __name__ == '__main__':
    unittest.main()
