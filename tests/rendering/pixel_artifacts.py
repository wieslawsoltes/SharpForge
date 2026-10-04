"""Bounded RGBA8 comparisons; backend baselines and external native WinUI references are distinct."""
import gzip
import hashlib
import json
import math
import re
import struct
import zlib
from pathlib import Path

from png_pixels import dimensions as validate_dimensions
from native_provenance import validate_native_xaml, compare_shape_defaults


def png_bytes(width, height, pixels):
    validate_dimensions(width, height)
    if len(pixels) != width * height * 4:
        raise ValueError('Invalid RGBA image byte count')
    straight = bytearray(pixels)
    for offset in range(0, len(pixels), 4):
        alpha = pixels[offset + 3]
        for channel in range(3):
            straight[offset + channel] = min(255, (pixels[offset + channel] * 255 + alpha // 2) // alpha) if alpha else 0
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    rows = b''.join(b'\0' + straight[index:index + width * 4] for index in range(0, len(straight), width * 4))
    header = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    return b'\x89PNG\r\n\x1a\n' + header + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def compare_pixels(actual, expected, tolerance):
    if len(actual) != len(expected) or not actual or len(actual) % 4 or len(actual) > 64 * 1024 * 1024:
        raise ValueError('Golden and actual RGBA dimensions differ or exceed the budget')
    for name, maximum in [('maxChannel', 255), ('meanChannel', 255), ('differentPixelFraction', 1)]:
        value = tolerance.get(name)
        if type(value) not in (float, int) or not math.isfinite(value) or not 0 <= value <= maximum:
            raise ValueError('Invalid pixel tolerance ' + name)
    max_channel = total = differing = 0
    difference = bytearray(len(actual))
    for offset in range(0, len(actual), 4):
        changed = False
        for channel in range(4):
            delta = abs(actual[offset + channel] - expected[offset + channel])
            max_channel = max(max_channel, delta)
            total += delta
            difference[offset + channel] = min(255, delta * 4)
            changed = changed or delta > tolerance['maxChannel']
        differing += int(changed)
        difference[offset + 3] = 255
    mean = total / len(actual)
    fraction = differing / (len(actual) // 4)
    return {'meanChannel': mean, 'maxChannel': max_channel, 'differentPixelFraction': fraction,
            'passed': mean <= tolerance['meanChannel'] and fraction <= tolerance['differentPixelFraction']}, bytes(difference)


def reference_paths(directory, fixture):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,95}', fixture['id']):
        raise ValueError('Invalid fixture artifact identifier')
    directory = Path(directory)
    return directory / (fixture['id'] + '.rgba.gz'), directory / (fixture['id'] + '.json')


def read_reference(raw, info, dimensions):
    if info.stat().st_size > 1024 * 1024 or raw.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('Reference byte budget exceeded')
    specification = json.loads(info.read_text())
    if specification.get('dimensions') != list(dimensions) or specification.get('alphaMode') != 'premultiplied':
        raise ValueError('Golden dimensions/alpha mode do not match the fixture')
    with gzip.open(raw, 'rb') as stream:
        expected = stream.read(64 * 1024 * 1024 + 1)
    if len(expected) != dimensions[0] * dimensions[1] * 4:
        raise ValueError('Reference byte count does not match its dimensions')
    return specification, expected


def golden_result(directory, fixture, pixels, dimensions, metadata, *, update=False):
    validate_dimensions(*dimensions)
    raw, info = reference_paths(directory, fixture)
    if update:
        if len(pixels) != dimensions[0] * dimensions[1] * 4:
            raise ValueError('Invalid golden pixel buffer')
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_bytes(gzip.compress(pixels, mtime=0))
        info.write_text(json.dumps({**metadata, 'dimensions': list(dimensions), 'alphaMode': 'premultiplied',
            'tolerance': fixture['tolerance'], 'referenceStatus': 'backend-baseline; native parity unqualified'}, indent=2) + '\n')
        return {'status': 'updated', 'passed': True}, None
    if not raw.is_file() or not info.is_file():
        return {'status': 'missing-reference', 'passed': False}, None
    specification, expected = read_reference(raw, info, dimensions)
    for name in ('actualBackend', 'actualTier', 'captureMode'):
        if specification.get(name) != metadata.get(name):
            raise ValueError('Backend reference does not match ' + name)
    result, difference = compare_pixels(pixels, expected, fixture['tolerance'])
    return {'status': 'passed' if result['passed'] else 'failed', **result}, difference


def native_result(directory, fixture, pixels, dimensions, *, windows_app_sdk, browser_environment=None, browser_defaults=None):
    """Read only provider-owned references; update-goldens can never produce a native reference."""
    if directory is None:
        return {'status': 'pending-native', 'passed': False, 'reason': 'No native WinUI reference provider'}, None
    raw, info = reference_paths(directory, fixture)
    if not raw.is_file() or not info.is_file():
        return {'status': 'pending-native', 'passed': False, 'reason': 'Native fixture capture is missing'}, None
    metadata, expected = read_reference(raw, info, dimensions)
    if metadata.get('referenceKind') != 'native-winui' or metadata.get('tool') != 'WinUI':
        raise ValueError('Provider pixels have no native WinUI provenance')
    if metadata.get('windowsAppSdkVersion') != windows_app_sdk:
        raise ValueError('Native WinUI reference SDK does not match the repository oracle pin')
    if not metadata.get('toolVersion') or not metadata.get('captureCommand') or not metadata.get('operatingSystem'):
        raise ValueError('Native reference tool and capture provenance are required')
    validate_native_xaml(metadata, fixture, expected, browser_environment)
    defaults = compare_shape_defaults(metadata.get('nativeDefaults', {}).get('shapeDefaults'), browser_defaults)
    result, difference = compare_pixels(pixels, expected, fixture['tolerance'])
    passed = result['passed'] and defaults['status'] != 'failed'
    return {'status': 'passed' if passed else 'failed', **result, 'passed': passed, 'provider': metadata,
            'nativeShapeDefaults': defaults, 'sha256': hashlib.sha256(expected).hexdigest()}, difference
