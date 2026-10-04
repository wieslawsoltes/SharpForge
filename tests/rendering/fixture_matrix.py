"""Every registered fixture has an explicit browser reference; new cases extend the sealed corpus."""
import json

from native_fixture_matrix import native_fixtures


REFERENCE_PROFILES = {
    'path-reference': 'browser-native-path',
    'shapes': 'browser-native-canvas',
    'strokes': 'browser-native-canvas',
    'gradients': 'browser-native-canvas',
    'images': 'browser-native-canvas',
    'clips': 'browser-native-canvas',
    'effects': 'browser-native-svg-effects',
    'opacity': 'browser-native-canvas',
    'text': 'independent-dom-text',
    'control-chrome': 'browser-native-canvas',
    'instances-10k': 'browser-native-canvas',
    'control-gallery': 'paired-public-facade',
    'composition-brushes': 'browser-native-svg-composition',
    'composition-trim': 'browser-native-svg-composition',
    'numeric-text': 'numeric-glyph-cross-raster',
    'atlas-residency': 'numeric-glyph-cross-raster',
    'rounded-matrix': 'browser-native-canvas',
    'ellipse-lines': 'browser-native-canvas',
    'alpha-overlap': 'browser-native-canvas',
    'instances-100k': 'browser-native-canvas',
    'dom-text-layout': 'independent-dom-text',
    'live-replay': 'live-canvas-before-serialization',
    'retained-scroll': 'paired-public-facade',
    'mixed-z-order': 'browser-native-canvas',
    'canvas-control': 'paired-public-facade',
    'host-bitmap-capture': 'public-host-capture',
    'native-ime': 'paired-public-facade',
    'native-xaml': 'native-xaml-and-paired-public-facade'
}


def load_fixture_matrix(directory, *, include_native=False):
    manifest = json.loads((directory / 'index.json').read_text())
    extra = json.loads((directory / 'browser-matrix.json').read_text())
    fixtures = []
    for original in manifest['fixtures'] + extra['fixtures']:
        row = dict(original)
        profile = REFERENCE_PROFILES.get(row['scene'])
        if profile is None:
            raise ValueError('Fixture has no declared browser reference: ' + row['id'])
        row['canvasReference'] = True
        row['browserReferenceProfile'] = profile
        row['reference'] = {**row.get('reference', {}), 'status': 'authored-unrun', 'kind': profile,
                            'nativeWinUI': 'requires-separate-native-capture'}
        fixtures.append(row)
    if include_native:
        fixtures.extend(native_fixtures(directory.parent / 'native'))
    identifiers = [row['id'] for row in fixtures]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError('Duplicate rendering fixture identifiers')
    return {**manifest, 'fixtures': fixtures, 'baselineFixtureCount': len(manifest['fixtures']),
            'browserReferencePolicy': 'Every fixture requires an independent browser reference or a distinct backend pair.'}


def paired_reference_backend(fixture, backend):
    profile = fixture['browserReferenceProfile']
    if profile in ('paired-public-facade', 'native-xaml-and-paired-public-facade'):
        return 'dom' if backend == 'canvas2d' else 'canvas2d'
    if profile == 'numeric-glyph-cross-raster' and backend == 'canvas2d':
        return 'dom'
    return None
