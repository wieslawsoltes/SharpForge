"""Qualification requires real evidence, including semantic verification and exact overlap thresholds."""
import hashlib
import math

from pixel_artifacts import compare_pixels


def paired_result(actual, expected, fixture, primary, reference):
    requested = reference['requested']
    if requested == primary['actualBackend'] or reference['actualBackend'] != requested:
        raise ValueError('A paired reference must use an available distinct backend')
    if reference['status'] != 'rendered' or reference.get('errors'):
        return {'status': 'failed', 'passed': False, 'reason': 'Reference backend failed to render'}, None
    result, difference = compare_pixels(actual, expected, fixture.get('canvasTolerance', fixture['tolerance']))
    return {'status': 'passed' if result['passed'] else 'failed', **result,
            'kind': 'paired-public-facade', 'requestedBackend': requested, 'actualBackend': reference['actualBackend'],
            'sha256': hashlib.sha256(expected).hexdigest(), 'sharedManagedInputs': True,
            'scope': 'Actual distinct browser backend agreement; shared layout/templates are not native WinUI evidence'}, difference


def verification_result(result, fixture):
    verification = result.get('verification')
    required = fixture.get('requiresVerification', False)
    if verification is None:
        return {'passed': not required, 'status': 'missing' if required else 'not-required'}
    if verification.get('passed') is False or str(verification.get('status', '')).startswith('incomplete'):
        return {'passed': False, 'status': 'incomplete',
                'reason': verification.get('reason', 'Required verification did not complete')}
    if required and verification.get('passed') is not True:
        return {'passed': False, 'status': 'missing-explicit-pass'}
    return {'passed': True, 'status': 'passed'}


def inspect_pixels(pixels, dimensions, fixture):
    width, height = dimensions
    scale_x = width / fixture['width']
    scale_y = height / fixture['height']
    failures = []
    checks = fixture.get('pixelChecks', [])
    if len(checks) > 1024:
        raise ValueError('Pixel assertion count exceeds budget')
    for check in checks:
        rect = check['rect']
        if len(rect) != 4 or any(type(value) not in (int, float) or not math.isfinite(value) for value in rect):
            raise ValueError('Invalid pixel assertion rectangle')
        left = max(0, math.floor(rect[0] * scale_x))
        top = max(0, math.floor(rect[1] * scale_y))
        right = min(width, math.ceil((rect[0] + rect[2]) * scale_x))
        bottom = min(height, math.ceil((rect[1] + rect[3]) * scale_y))
        if right <= left or bottom <= top or (right - left) * (bottom - top) > 100000:
            raise ValueError('Pixel assertion is empty or exceeds its sample budget')
        alphas = [pixels[(y * width + x) * 4 + 3] for y in range(top, bottom) for x in range(left, right)]
        if check['kind'] == 'transparent' and max(alphas) != 0:
            failures.append(check['name'] + ': centre was not transparent')
        elif check['kind'] == 'visible' and max(alphas) < check.get('minimumAlpha', 1):
            failures.append(check['name'] + ': no visible coverage')
        elif check['kind'] not in ('transparent', 'visible'):
            raise ValueError('Unknown pixel assertion kind')
    return {'passed': not failures, 'checks': len(checks), 'failures': failures}
