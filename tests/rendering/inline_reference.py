"""Declared Canvas reference providers compare real rasters without qualifying native WinUI parity."""
import base64
import hashlib

from pixel_artifacts import compare_pixels
from png_pixels import dimensions as validate_dimensions


def canvas_result(packet, fixture, pixels, dimensions):
    if packet is None:
        return {'status': 'missing-canvas-reference', 'passed': not fixture.get('canvasReference', False)}, None, None
    profiles = {('canvas2d-numeric-outline', 'harfbuzz', 'numeric-glyphs'),
                ('canvas2d-native-path', 'browser-native-svg', 'not-applicable'),
                ('canvas2d-declared-scene', 'browser-native-canvas', 'not-applicable'),
                ('svg-declared-scene', 'browser-native-svg', 'not-applicable'),
                ('canvas2d-dom-text', 'browser-native-dom', 'opaque-native-runs'),
                ('canvas2d-live-replay', 'live-canvas-before-serialization', 'not-applicable'),
                ('canvas2d-host-bitmap', 'public-host-renderToBitmap', 'not-applicable')}
    if ((packet.get('kind'), packet.get('provider'), packet.get('glyphAccess')) not in profiles
            or packet.get('alphaMode') != 'premultiplied'):
        raise ValueError('Canvas reference has no declared independent provider or alpha convention')
    if packet['kind'] in ('canvas2d-declared-scene', 'svg-declared-scene', 'canvas2d-dom-text'):
        if packet.get('input') != 'fixture-declaration' or packet.get('sharedRendererCode') is not False:
            raise ValueError('A declared browser reference cannot replay the implementation display list')
    if packet['kind'] == 'svg-declared-scene':
        digest = packet.get('sourceSha256')
        if not isinstance(digest, str) or len(digest) != 64 or any(character not in '0123456789abcdef' for character in digest):
            raise ValueError('SVG reference must identify its actual source bytes')
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
            'sourceSha256': packet.get('sourceSha256'), 'sharedRendererCode': packet.get('sharedRendererCode'),
            'scope': ('Actual public host capture compared with on-screen pixels; native WinUI parity remains separate'
                      if packet['kind'] == 'canvas2d-host-bitmap' else
                      'Declared Canvas raster comparison; native WinUI parity remains separate')}, difference, expected
