"""Declared Canvas reference providers compare real rasters without qualifying native WinUI parity."""
import base64
import hashlib

from pixel_artifacts import compare_pixels
from png_pixels import dimensions as validate_dimensions


def canvas_result(packet, fixture, pixels, dimensions):
    if packet is None:
        return {'status': 'missing-canvas-reference', 'passed': not fixture.get('canvasReference', False)}, None, None
    profiles = {('canvas2d-numeric-outline', 'harfbuzz', 'numeric-glyphs'),
                ('canvas2d-native-path', 'browser-native-svg', 'not-applicable')}
    if ((packet.get('kind'), packet.get('provider'), packet.get('glyphAccess')) not in profiles
            or packet.get('alphaMode') != 'premultiplied'):
        raise ValueError('Canvas reference has no declared independent provider or alpha convention')
    validate_dimensions(packet.get('width'), packet.get('height'))
    if (packet['width'], packet['height']) != dimensions:
        raise ValueError('Canvas reference dimensions differ')
    encoded = packet.get('rgba')
    if not isinstance(encoded, str) or len(encoded) > 90 * 1024 * 1024:
        raise ValueError('Canvas reference byte budget exceeded')
    expected = base64.b64decode(encoded, validate=True)
    if len(expected) != dimensions[0] * dimensions[1] * 4:
        raise ValueError('Canvas reference has an invalid RGBA byte count')
    result, difference = compare_pixels(pixels, expected, fixture.get('canvasTolerance', fixture['tolerance']))
    return {'status': 'passed' if result['passed'] else 'failed', **result,
            'kind': packet['kind'], 'provider': packet['provider'], 'sha256': hashlib.sha256(expected).hexdigest(),
            'scope': 'Declared Canvas raster comparison; native WinUI parity remains separate'}, difference, expected
