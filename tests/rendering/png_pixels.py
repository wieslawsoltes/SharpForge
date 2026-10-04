"""Bounded PNG screenshot decoding; pixels returned in premultiplied RGBA8 space."""
import math
import struct
import zlib

MAX_BYTES = 64 * 1024 * 1024


def dimensions(width, height):
    if type(width) is not int or type(height) is not int or min(width, height) < 1 or width * height > 16777216:
        raise ValueError('Invalid or oversized RGBA image dimensions')


def chunks(data):
    if not isinstance(data, bytes) or len(data) > MAX_BYTES or data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Invalid or oversized PNG screenshot')
    offset = 8
    while offset + 12 <= len(data):
        length = struct.unpack_from('>I', data, offset)[0]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError('Truncated PNG chunk')
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:end - 4]
        checksum = struct.unpack_from('>I', data, end - 4)[0]
        if zlib.crc32(kind + payload) != checksum:
            raise ValueError('PNG checksum mismatch')
        yield kind, payload
        offset = end
        if kind == b'IEND':
            if length or offset != len(data):
                raise ValueError('Invalid PNG terminator')
            return
    raise ValueError('PNG has no complete terminator')


def paeth(left, above, upper_left):
    prediction = left + above - upper_left
    distance = [abs(prediction - value) for value in (left, above, upper_left)]
    return (left, above, upper_left)[distance.index(min(distance))]


def unfilter(raw, width, height, channels):
    stride = width * channels
    result = bytearray(height * stride)
    for row in range(height):
        source = row * (stride + 1)
        kind = raw[source]
        if kind > 4:
            raise ValueError('Invalid PNG scanline filter')
        for column in range(stride):
            offset = row * stride + column
            left = result[offset - channels] if column >= channels else 0
            above = result[offset - stride] if row else 0
            upper_left = result[offset - stride - channels] if row and column >= channels else 0
            if kind == 0:
                prediction = 0
            elif kind == 1:
                prediction = left
            elif kind == 2:
                prediction = above
            elif kind == 3:
                prediction = (left + above) // 2
            else:
                prediction = paeth(left, above, upper_left)
            result[offset] = (raw[source + 1 + column] + prediction) & 255
    return result


def decode_png(data):
    header = None
    compressed = bytearray()
    for kind, payload in chunks(data):
        if header is None and kind != b'IHDR':
            raise ValueError('PNG header must be first')
        if kind == b'IHDR':
            if header is not None or len(payload) != 13:
                raise ValueError('Invalid PNG header')
            header = struct.unpack('>IIBBBBB', payload)
            width, height, bits, color, compression, filtering, interlace = header
            dimensions(width, height)
            if bits != 8 or color not in (0, 2, 4, 6) or compression or filtering or interlace:
                raise ValueError('Only non-interlaced eight-bit grayscale/RGB/RGBA screenshots are supported')
        elif kind == b'IDAT':
            compressed.extend(payload)
        elif kind in (b'tRNS', b'acTL'):
            raise ValueError('Palette transparency and animated PNG screenshots are unsupported')
        elif kind not in (b'IEND', b'PLTE') and not kind[0] & 32:
            raise ValueError('Unsupported critical PNG chunk')
    if header is None or not compressed:
        raise ValueError('PNG pixel payload is missing')
    width, height, _, color, _, _, _ = header
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color]
    expected = (width * channels + 1) * height
    decoder = zlib.decompressobj()
    raw = decoder.decompress(compressed, expected + 1)
    if len(raw) != expected or not decoder.eof or decoder.unused_data:
        raise ValueError('PNG decoded byte count does not match its dimensions')
    scanlines = unfilter(raw, width, height, channels)
    pixels = bytearray(width * height * 4)
    for index in range(width * height):
        source = index * channels
        alpha = scanlines[source + channels - 1] if color in (4, 6) else 255
        for channel in range(3):
            component = scanlines[source + (channel if color in (2, 6) else 0)]
            pixels[index * 4 + channel] = (component * alpha + 127) // 255
        pixels[index * 4 + 3] = alpha
    return width, height, bytes(pixels)


def screenshot_pixels(data, rectangle, viewport):
    width, height, pixels = decode_png(data)
    values = [rectangle.get(name) for name in ('x', 'y', 'width', 'height')]
    values.extend(viewport.get(name) for name in ('width', 'height'))
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in values):
        raise ValueError('Invalid screenshot rectangle')
    x, y, css_width, css_height, viewport_width, viewport_height = values
    if min(css_width, css_height, viewport_width, viewport_height) <= 0 or min(x, y) < 0:
        raise ValueError('Invalid screenshot rectangle extent')
    left, top = round(x * width / viewport_width), round(y * height / viewport_height)
    right = round((x + css_width) * width / viewport_width)
    bottom = round((y + css_height) * height / viewport_height)
    if not 0 <= left < right <= width or not 0 <= top < bottom <= height:
        raise ValueError('Fixture extends outside the captured browser viewport')
    cropped = b''.join(pixels[(row * width + left) * 4:(row * width + right) * 4] for row in range(top, bottom))
    return (right - left, bottom - top), cropped
