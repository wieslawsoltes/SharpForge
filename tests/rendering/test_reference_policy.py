import base64
import copy
import json
import tempfile
import unittest
from pathlib import Path

from fixture_matrix import load_fixture_matrix, paired_reference_backend
from inline_reference import canvas_result
from reference_policy import paired_result, verification_result, inspect_pixels

HERE = Path(__file__).resolve().parent
EXACT = {'maxChannel': 1, 'meanChannel': 1, 'differentPixelFraction': 0}


class ReferencePolicyTests(unittest.TestCase):
    def test_every_original_fixture_has_a_required_reference_and_same_backend_cannot_be_its_own_pair(self):
        manifest = load_fixture_matrix(HERE / 'fixtures')
        baseline = json.loads((HERE / 'fixtures/index.json').read_text())['fixtures']
        self.assertEqual(manifest['baselineFixtureCount'], 62)
        self.assertTrue({row['id'] for row in baseline}.issubset({row['id'] for row in manifest['fixtures']}))
        self.assertTrue(all(row['canvasReference'] and row['browserReferenceProfile'] for row in manifest['fixtures']))
        gallery = next(row for row in manifest['fixtures'] if row['scene'] == 'control-gallery')
        for backend in ('webgpu', 'canvas2d', 'dom'):
            self.assertNotEqual(paired_reference_backend(gallery, backend), backend)
        for backend in ('webgpu', 'canvas2d', 'dom'):
            record = {'requested': backend, 'actualBackend': backend, 'status': 'rendered', 'errors': []}
            with self.assertRaises(ValueError):
                paired_result(bytes(4), bytes(4), {'tolerance': EXACT}, record, record)

    def test_missing_or_incomplete_geometry_evidence_cannot_qualify(self):
        required = {'requiresVerification': True}
        for observation in ({}, {'verification': {}}, {'verification': {'passed': False}},
                            {'verification': {'status': 'incomplete-native-figures', 'passed': True}}):
            self.assertFalse(verification_result(observation, required)['passed'])
        self.assertTrue(verification_result({'verification': {'passed': True}}, required)['passed'])
        self.assertFalse(verification_result({'verification': {'passed': False}}, {})['passed'])

    def test_exact_one_byte_overlap_oracle_rejects_even_one_two_byte_channel_error(self):
        fixture = {'tolerance': EXACT}
        primary = {'actualBackend': 'webgpu'}
        reference = {'requested': 'canvas2d', 'actualBackend': 'canvas2d', 'status': 'rendered', 'errors': []}
        expected = bytes([0, 0, 0, 255] * 100)
        one = bytearray(expected)
        one[0] = 1
        result, _ = paired_result(bytes(one), expected, fixture, primary, reference)
        self.assertTrue(result['passed'])
        one[0] = 2
        result, _ = paired_result(bytes(one), expected, fixture, primary, reference)
        self.assertFalse(result['passed'])
        self.assertEqual(result['maxChannel'], 2)

    def test_declared_browser_oracle_rejects_renderer_replay_and_svg_without_source_hash(self):
        pixels = bytes([0, 0, 0, 255])
        fixture = {'canvasReference': True, 'tolerance': EXACT}
        packet = {'kind': 'canvas2d-declared-scene', 'provider': 'browser-native-canvas', 'glyphAccess': 'not-applicable',
                  'width': 1, 'height': 1, 'rgba': base64.b64encode(pixels).decode(), 'alphaMode': 'premultiplied',
                  'input': 'fixture-declaration', 'sharedRendererCode': False}
        self.assertTrue(canvas_result(packet, fixture, pixels, (1, 1))[0]['passed'])
        for change in ({'sharedRendererCode': True}, {'input': 'implementation-display-list'}):
            with self.assertRaises(ValueError):
                canvas_result({**packet, **change}, fixture, pixels, (1, 1))
        svg = {**packet, 'kind': 'svg-declared-scene', 'provider': 'browser-native-svg'}
        with self.assertRaises(ValueError):
            canvas_result(svg, fixture, pixels, (1, 1))
        self.assertTrue(canvas_result({**svg, 'sourceSha256': '0' * 64}, fixture, pixels, (1, 1))[0]['passed'])

    def test_independent_pixel_assertions_check_transparent_centres_and_visible_half_pixel_lines(self):
        fixture = {'width': 2, 'height': 1, 'pixelChecks': [
            {'name': 'centre', 'kind': 'transparent', 'rect': [0, 0, 1, 1]},
            {'name': 'thin line', 'kind': 'visible', 'rect': [1, 0, 1, 1]}]}
        self.assertTrue(inspect_pixels(bytes([0, 0, 0, 0, 0, 0, 0, 1]), (2, 1), fixture)['passed'])
        self.assertFalse(inspect_pixels(bytes([0, 0, 0, 1, 0, 0, 0, 0]), (2, 1), fixture)['passed'])
        invalid = copy.deepcopy(fixture)
        invalid['pixelChecks'][0]['rect'][2] = 0
        with self.assertRaises(ValueError):
            inspect_pixels(bytes(8), (2, 1), invalid)

    def test_unknown_reference_profile_fails_instead_of_falling_back_to_a_self_golden(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'index.json').write_text(json.dumps({'fixtures': [{'id': 'unknown', 'scene': 'unregistered'}]}))
            (root / 'browser-matrix.json').write_text('{"fixtures": []}')
            with self.assertRaises(ValueError):
                load_fixture_matrix(root)


if __name__ == '__main__':
    unittest.main()
