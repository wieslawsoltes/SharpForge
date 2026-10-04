"""Strict consumer checks bind a native pixel packet to the same XAML, scale, theme, and real capture environment."""
import hashlib
import math
import re


def validate_font_observations(values):
    if not isinstance(values, list) or not 1 <= len(values) <= 64:
        raise ValueError('Native text reference is missing bounded installed-font provenance')
    for row in values:
        if (not isinstance(row, dict) or not re.fullmatch(r'[a-z0-9-]{1,64}\.ttf', row.get('name', ''))
                or type(row.get('available')) is not bool
                or row['available'] and not re.fullmatch(r'[a-f0-9]{64}', row.get('sha256', ''))):
            raise ValueError('Native installed-font evidence is malformed')
    if not any(row['name'] == 'segoeui.ttf' and row['available'] for row in values):
        raise ValueError('Native Segoe UI fixture has no observed installed Segoe UI font bytes')


def validate_native_xaml(metadata, fixture, pixels, browser_environment):
    if fixture.get('scene') != 'native-xaml':
        return
    expected = {key: fixture[key] for key in ('id', 'width', 'height', 'dpr', 'theme')}
    expected['focusTarget'] = fixture.get('focusTarget')
    if (metadata.get('schemaVersion') != 1 or metadata.get('fixture') != expected
            or metadata.get('xamlSha256') != fixture.get('xamlSha256')
            or metadata.get('captureMode') != 'native-render-target-bitmap'
            or metadata.get('rasterScaleMode') != 'render-target-explicit-size'
            or metadata.get('origin') != 'top-left' or metadata.get('colorSpace') != 'srgb'):
        raise ValueError('Native pixel metadata does not identify the exact shared XAML fixture')
    for field in ('inputHash', 'pixelSha256', 'bgraSha256'):
        if not re.fullmatch(r'[a-f0-9]{64}', metadata.get(field, '')):
            raise ValueError('Native provenance is missing the ' + field + ' digest')
    if metadata['pixelSha256'] != hashlib.sha256(pixels).hexdigest():
        raise ValueError('Native pixel bytes differ from their provider hash')
    if (not re.fullmatch(r'[a-f0-9]{40}', metadata.get('sourceRevision', ''))
            or type(metadata.get('sourceDirty')) is not bool):
        raise ValueError('Native reference needs an exact source revision and dirty-state observation')
    command = metadata.get('captureCommand')
    if (not isinstance(command, list) or not 1 <= len(command) <= 64
            or any(not isinstance(value, str) or len(value) > 4096 for value in command)):
        raise ValueError('Native capture command must be a bounded actual argv array')
    operating_system = metadata.get('operatingSystem', {})
    if ('windows' not in str(operating_system.get('description', '')).lower()
            or operating_system.get('architecture') != 'X64'):
        raise ValueError('Native WinUI reference was not captured on the declared Windows x64 runtime')
    policy = metadata.get('stabilityPolicy', {})
    if policy != {'consecutiveCaptures': 3, 'maximumRenderingTurns': 120, 'freshProcesses': 2}:
        raise ValueError('Native reference lacks the required stable repeated-capture evidence')
    environment = metadata.get('nativeEnvironment', {})
    for key in ('rasterizationScale', 'textScaleFactor'):
        if (type(environment.get(key)) not in (int, float)
                or not math.isfinite(environment[key]) or environment[key] <= 0):
            raise ValueError('Native environment lacks a finite positive ' + key)
    if (type(environment.get('highContrast')) is not bool
            or environment.get('actualTheme') != fixture['theme'] or not isinstance(browser_environment, dict)):
        raise ValueError('Native/browser theme and accessibility environment evidence is missing')
    for key in ('highContrast', 'textScaleFactor', 'actualTheme'):
        if environment.get(key) != browser_environment.get(key):
            raise ValueError('Native/browser environment differs for ' + key)
    if fixture.get('requiredFonts'):
        validate_font_observations(environment.get('installedFontFiles'))
    for index in range(0, len(pixels), 4):
        if any(channel > pixels[index + 3] for channel in pixels[index:index + 3]):
            raise ValueError('Native pixel data violates its premultiplied alpha contract')


def compare_shape_defaults(expected, actual):
    if expected is None:
        return {'status': 'unavailable', 'passed': False, 'reason': 'Native provider did not observe shape defaults'}
    types = ['Microsoft.UI.Xaml.Shapes.' + name for name in ('Rectangle', 'Ellipse', 'Line', 'Path', 'Polygon', 'Polyline')]
    if (not isinstance(expected, list) or len(expected) != len(types)
            or any(not isinstance(item, dict) for item in expected)
            or {item.get('type') for item in expected} != set(types)):
        raise ValueError('Native shape-default evidence has an invalid type set')
    for item in expected:
        if (type(item.get('strokeThickness')) not in (int, float) or not math.isfinite(item['strokeThickness'])
                or item['strokeThickness'] < 0 or item.get('stretch') not in ('None', 'Fill', 'Uniform', 'UniformToFill')
                or any(type(item.get(field)) is not bool for field in ('strokeHasLocalValue', 'stretchHasLocalValue'))):
            raise ValueError('Native shape-default fields are incomplete or malformed')
    if not isinstance(actual, list) or len(actual) != len(types):
        return {'status': 'failed', 'passed': False, 'reason': 'Browser facade shape-default observations are unavailable'}
    rows = {item.get('type'): item for item in actual}
    failures = []
    for item in expected:
        row = rows.get(item['type'], {})
        for field in ('strokeThickness', 'stretch', 'strokeHasLocalValue', 'stretchHasLocalValue'):
            if item.get(field) != row.get(field):
                failures.append({'type': item['type'], 'field': field, 'expected': item.get(field), 'actual': row.get(field)})
        for getter, field in [('strokeViaGetValue', 'strokeThickness'), ('stretchViaGetValue', 'stretch')]:
            if row.get(getter) != row.get(field):
                failures.append({'type': item['type'], 'field': getter, 'expected': row.get(field), 'actual': row.get(getter)})
    return {'status': 'failed' if failures else 'passed', 'passed': not failures,
            'types': len(types), 'failures': failures, 'reference': 'Fresh native WinUI objects, including local-value observations'}
