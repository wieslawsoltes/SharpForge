"""Observe native Playwright WebSocket frames without modifying the application or transport."""
import json
import time


FRAME_TYPES = frozenset(('auth', 'ready', 'update', 'ack', 'sync-request', 'sync-start', 'sync-batch',
                         'sync-end', 'presence', 'peer-joined', 'peer-left', 'error', 'initialize', 'initialized'))


def observe_websockets(page):
    evidence = {'connections': 0, 'closed': 0, 'sent': {}, 'received': {}}

    def frame(direction, payload):
        try:
            message = json.loads(payload)
        except (ValueError, TypeError, UnicodeError):
            return
        kind = message.get('type') if isinstance(message, dict) else None
        if isinstance(kind, str) and kind in FRAME_TYPES:
            counts = evidence[direction]
            counts[kind] = counts.get(kind, 0) + 1

    def socket_opened(socket):
        evidence['connections'] += 1
        socket.on('framesent', lambda payload: frame('sent', payload))
        socket.on('framereceived', lambda payload: frame('received', payload))
        socket.on('close', lambda *_: evidence.update(closed=evidence['closed'] + 1))

    page.on('websocket', socket_opened)
    return evidence


def wait_for_frame(page, evidence, direction, kind, after=0, timeout=20):
    deadline = time.monotonic() + timeout
    while evidence[direction].get(kind, 0) <= after:
        if time.monotonic() >= deadline:
            raise AssertionError('Native WebSocket frame not observed: ' + json.dumps({
                'direction': direction, 'type': kind, 'after': after, 'evidence': evidence}))
        page.wait_for_timeout(25)


def snapshot_evidence(evidence):
    # Counts only: authentication payloads, SDP, content and tokens never enter this report.
    return json.loads(json.dumps(evidence))
