"""Real, bounded loopback HTTP gates; no credentials or arbitrary endpoints."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time


TAGS = frozenset(('alpha', 'beta', 'alpha-copy'))


class GateServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        self.slots = threading.BoundedSemaphore(8)
        self.condition = threading.Condition()
        self.active = 0
        super().__init__(('127.0.0.1', 0), Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        with self.condition:
            self.active += 1
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.completed()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.completed()

    def completed(self):
        with self.condition:
            self.active -= 1
            self.slots.release()
            self.condition.notify_all()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def do_GET(self):
        owner = self.server.fixture
        tag = self.path.removeprefix('/hold/')
        if self.path != '/hold/' + tag or tag not in TAGS:
            self.send_error(404)
            return
        gate = owner.gate(tag)
        if gate is None:
            owner.record('unexpected', tag)
            self.send_error(409, 'The fixture did not arm this request')
            return
        owner.record('received', tag, cookiePresent=bool(self.headers.get('Cookie')),
                     authorizationPresent=bool(self.headers.get('Authorization')))
        released = gate.wait(60)
        body = tag.encode('ascii') if released else b'fixture-deadline'
        try:
            self.send_response(200 if released else 504)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            owner.record('responded' if released else 'deadline', tag)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            owner.record('disconnected', tag)


class Endpoint:
    def __init__(self):
        self.started = time.monotonic()
        self.lock = threading.Lock()
        self.gates = {}
        self.events = []
        self.server = GateServer()
        self.server.fixture = self
        self.origin = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def record(self, event, tag, **details):
        with self.lock:
            if len(self.events) >= 64:
                raise RuntimeError('Session I/O endpoint event bound exceeded')
            self.events.append({'event': event, 'tag': tag, 'milliseconds':
                                (time.monotonic() - self.started) * 1000, **details})

    def gate(self, tag):
        with self.lock:
            # Exactly one real request is allowed for an armed application.
            return self.gates.pop(tag, None)

    def arm(self, tags):
        with self.lock:
            if self.gates or any(tag not in TAGS for tag in tags) or len(set(tags)) != len(tags):
                raise ValueError('Invalid or overlapping endpoint gate set')
            gates = {tag: threading.Event() for tag in tags}
            self.gates.update(gates)
        return gates

    def snapshot(self):
        with self.lock:
            return [dict(event) for event in self.events]

    def wait(self, tag, events=('received',), timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if any(event['tag'] == tag and event['event'] in events for event in self.snapshot()):
                return
            time.sleep(0.01)
        raise TimeoutError('Owned HTTP endpoint did not observe ' + '/'.join(events) + ' for ' + tag)

    def close(self, gates):
        for gate in gates.values():
            gate.set()
        self.server.shutdown()
        self.server.server_close()
        with self.server.condition:
            if not self.server.condition.wait_for(lambda: self.server.active == 0, timeout=5):
                raise RuntimeError('Session I/O endpoint handlers did not stop')
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            raise RuntimeError('Session I/O endpoint did not stop')
