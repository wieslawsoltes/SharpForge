"""Read the producer's exact shared XAML catalog without relabeling unrelated browser scenes as native references."""
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET

TEXT_CONTROLS = {'TextBlock', 'RichTextBlock', 'TextBox', 'PasswordBox', 'Button', 'CheckBox', 'RadioButton', 'ToggleSwitch'}


def native_fixtures(directory):
    catalog_file = directory / 'fixtures.json'
    if catalog_file.stat().st_size > 256 * 1024:
        raise ValueError('Native fixture catalog exceeds its budget')
    catalog = json.loads(catalog_file.read_text())
    fixtures = catalog.get('fixtures')
    if catalog.get('schemaVersion') != 1 or catalog.get('captureProfile') != 'static-xaml':
        raise ValueError('Unrecognized native XAML fixture schema')
    if not isinstance(fixtures, list) or not 1 <= len(fixtures) <= 128:
        raise ValueError('Invalid native XAML fixture count')
    result = []
    identifiers = set()
    total_pixels = 0
    for item in fixtures:
        if (not isinstance(item, dict) or not re.fullmatch(r'native-xaml-[a-z0-9-]{1,78}', item.get('id', ''))
                or item['id'] in identifiers or not re.fullmatch(r'[a-z][a-z0-9-]{0,63}\.xaml', item.get('file', ''))
                or not re.fullmatch(r'[a-f0-9]{64}', item.get('xamlSha256', ''))
                or item.get('theme') not in ('Light', 'Dark') or item.get('expected') not in ('pixels', 'load-error')):
            raise ValueError('Invalid or duplicate native XAML fixture identity')
        identifiers.add(item['id'])
        width, height, dpr = (item.get(key) for key in ('width', 'height', 'dpr'))
        if (any(type(value) not in (int, float) or not math.isfinite(value) for value in (width, height, dpr))
                or not 1 <= width <= 2048 or not 1 <= height <= 2048 or not 0.5 <= dpr <= 4):
            raise ValueError('Invalid native fixture dimensions')
        if item.get('focusTarget') is not None and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}', item['focusTarget']):
            raise ValueError('Invalid native fixture focus target')
        tolerance = item.get('tolerance', {})
        for key, maximum in [('maxChannel', 255), ('meanChannel', 255), ('differentPixelFraction', 1)]:
            value = tolerance.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
                raise ValueError('Invalid native fixture tolerance ' + key)
        pixels = math.ceil(width * dpr) * math.ceil(height * dpr)
        total_pixels += pixels
        if pixels > 4 * 1024 * 1024 or total_pixels > 16 * 1024 * 1024:
            raise ValueError('Native fixture pixel budget exceeded')
        path = directory / 'fixtures' / item['file']
        if not 0 < path.stat().st_size <= 256 * 1024:
            raise ValueError('Native XAML input exceeds its budget')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != item['xamlSha256']:
            raise ValueError('Native XAML fixture bytes differ from the pinned shared input')
        if item['expected'] == 'load-error':
            # The native producer validates its negative observation; a load error has no positive pixel oracle.
            continue
        element = ET.fromstring(data)
        needs_text = any(node.tag.rsplit('}', 1)[-1] in TEXT_CONTROLS for node in element.iter())
        result.append({**item, 'scene': 'native-xaml', 'requiresVerification': True,
                       'requiredFonts': ['Segoe UI'] if needs_text else [], 'nativeReferenceRequired': True,
                       'browserReferenceProfile': 'native-xaml-and-paired-public-facade', 'canvasReference': True})
    return result
