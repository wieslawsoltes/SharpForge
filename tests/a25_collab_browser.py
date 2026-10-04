"""Actual two-context WebRTC, IndexedDB reload and cursor qualification over loopback HTTP/CSP.

Uses the repository's pinned Python Playwright. Missing engines fail explicitly;
no in-memory DOM, IndexedDB or RTCPeerConnection replacement can satisfy this run.
"""
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from importlib.metadata import version
import argparse
import hashlib
import json
import queue
import re
import subprocess
import sys
import threading
import time
import traceback

from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir, selected_engine
from a25_collab_observers import observe_websockets, snapshot_evidence, wait_for_frame


ROOT = Path(__file__).resolve().parents[1]


def wait(page, expression, timeout=20):
    deadline = time.monotonic() + timeout
    while True:
        value = page.evaluate(expression)
        if value:
            return value
        if time.monotonic() >= deadline:
            raise AssertionError('Browser condition did not converge: ' + expression)
        page.wait_for_timeout(25)


def ready(page):
    wait(page, 'Boolean(window.collaborationFixture)')
    return wait(page, 'collaborationFixture.snapshot().status.synchronized')


def failure_snapshots(browser):
    snapshots = []
    for context_index, context in enumerate(browser.contexts):
        for page_index, page in enumerate(context.pages):
            entry = {'context': context_index, 'page': page_index, 'url': page.url}
            try:
                entry['snapshot'] = page.evaluate('window.collaborationFixture?.snapshot() ?? null')
            except BaseException as error:
                entry['diagnosticError'] = str(error)
            snapshots.append(entry)
    return snapshots


def launcher_diagnostics(directory):
    """Reference the existing launcher's completed log without duplicating messages or URL query credentials."""
    path = directory / 'console.log'
    if not path.is_file():
        return {'status': 'not-retained', 'path': path.name}
    data = path.read_bytes()
    events = []
    counts = {'pageErrors': 0, 'failedRequests': 0, 'httpErrors': 0}
    for number, line in enumerate(data.decode('utf-8', errors='replace').splitlines(), 1):
        event = None
        if line.startswith('pageerror: '):
            counts['pageErrors'] += 1
            event = {'kind': 'pageerror', 'line': number}
        elif line.startswith('requestfailed: '):
            counts['failedRequests'] += 1
            url, _, failure = line[len('requestfailed: '):].partition(' ')
            event = {'kind': 'requestfailed', 'line': number, 'path': urlsplit(url).path}
            if re.fullmatch(r'net::[A-Z0-9_]+', failure):
                event['code'] = failure
        elif line.startswith('console.error: '):
            match = re.search(r'the server responded with a status of (\d{3})\b', line)
            if match:
                counts['httpErrors'] += 1
                event = {'kind': 'http-error', 'line': number, 'status': int(match[1])}
        if event is not None and len(events) < 64:
            events.append(event)
    return {'status': 'retained', 'artifact': {'path': path.name, 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()}, 'counts': counts, 'events': events,
            'truncated': sum(counts.values()) > len(events),
            'interpretation': 'Line references identify exact retained launcher messages. Query strings and message bodies '
                              'are not copied; diagnostics do not replace any scenario assertion.'}


def start_server():
    process = subprocess.Popen(['node', 'tests/fixtures/a25-collab-server.mjs'], cwd=ROOT,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        line = lines.get(timeout=15)
        if not line:
            raise RuntimeError('Collaboration server did not start: ' + process.stderr.read())
        return process, json.loads(line)
    except BaseException:
        process.terminate()
        process.wait(timeout=5)
        raise


def control(base, action):
    with urlopen(Request(base + '/control/' + action, data=b'', method='POST'), timeout=5) as response:
        assert response.status == 204


def run(browser, base, scope='full', socket_evidence=None):
    full_scope = scope == 'full'
    socket_evidence = {} if socket_evidence is None else socket_evidence

    def fixture_url(**parameters):
        if not full_scope:
            parameters['transport'] = 'websocket'
        return base + '/test.html?' + urlencode(parameters)

    alpha_context = browser.new_context()
    beta_context = browser.new_context()
    alpha = alpha_context.new_page()
    beta = beta_context.new_page()
    socket_evidence['Alpha'] = observe_websockets(alpha)
    socket_evidence['Beta'] = observe_websockets(beta)
    alpha_url = fixture_url(name='Alpha', mode='create', seed='abcd')
    alpha.goto(alpha_url)
    ready(alpha)
    beta.goto(fixture_url(name='Beta'))
    ready(beta)
    wait(beta, 'collaborationFixture.snapshot().text === "abcd"')
    if full_scope:
        wait(alpha, 'collaborationFixture.snapshot().metrics.connectedPeers === 1')
        wait(beta, 'collaborationFixture.snapshot().metrics.connectedPeers === 1')
    else:
        assert alpha.evaluate('collaborationFixture.snapshot().transport') == 'websocket'
        assert beta.evaluate('collaborationFixture.snapshot().transport') == 'websocket'
        wait_for_frame(alpha, socket_evidence['Alpha'], 'received', 'ready')
        wait_for_frame(beta, socket_evidence['Beta'], 'received', 'ready')
    alpha.evaluate('collaborationFixture.select(2)')
    beta.evaluate('collaborationFixture.select(3, 1)')
    wait(alpha, 'collaborationFixture.snapshot().peers.some(p => p.name === "Beta" && p.selection?.anchor === 3)')
    wait(beta, 'collaborationFixture.snapshot().peers.some(p => p.name === "Alpha" && p.selection?.anchor === 2)')
    wait(alpha, 'document.querySelectorAll(".git-remote-caret").length === 1')
    wait(beta, 'document.querySelectorAll(".git-remote-caret").length === 1')
    assert alpha.locator('.git-remote-selection').count() >= 1
    assert alpha.evaluate('collaborationFixture.snapshot().callbacksPreserved')
    assert beta.evaluate('collaborationFixture.snapshot().callbacksPreserved')
    before_typing = snapshot_evidence(socket_evidence)
    alpha.locator('.sf-input').focus()
    alpha.evaluate('collaborationFixture.select(0)')
    alpha.keyboard.insert_text('!')
    wait(beta, 'collaborationFixture.snapshot().text === "!abcd"')
    if full_scope:
        wait(beta, 'collaborationFixture.snapshot().metrics.directReceived > 0')
        wait(alpha, 'collaborationFixture.snapshot().metrics.directSent > 0')
    else:
        wait_for_frame(alpha, socket_evidence['Alpha'], 'sent', 'update', before_typing['Alpha']['sent'].get('update', 0))
        wait_for_frame(beta, socket_evidence['Beta'], 'received', 'update', before_typing['Beta']['received'].get('update', 0))
        wait_for_frame(alpha, socket_evidence['Alpha'], 'received', 'ack', before_typing['Alpha']['received'].get('ack', 0))
    wait(alpha, 'collaborationFixture.snapshot().status.pending === 0')
    actor = alpha.evaluate('collaborationFixture.snapshot().identity.clientId')
    delivery_metrics = (alpha.evaluate('collaborationFixture.snapshot().metrics') if full_scope
                        else snapshot_evidence(socket_evidence))
    control(base, 'offline')
    wait(alpha, '!collaborationFixture.snapshot().status.connected')
    wait(beta, '!collaborationFixture.snapshot().status.connected')
    alpha.evaluate('collaborationFixture.edit(2, 0, "A")')
    beta.evaluate('collaborationFixture.edit(5, 0, "B")')
    before = alpha.evaluate('collaborationFixture.snapshot()')
    assert before['status']['pending'] == 1 and before['status']['unsaved'] == 0
    assert before['status']['persistent'] is True
    alpha.reload()
    wait(alpha, 'Boolean(window.collaborationFixture)')
    restored = alpha.evaluate('collaborationFixture.snapshot()')
    assert restored['identity']['clientId'] == actor, (actor, restored)
    assert restored['text'] == '!aAbcd' and restored['editor'] == restored['text']
    assert restored['status']['pending'] == 1 and restored['status']['unsaved'] == 0
    control(base, 'online')
    alpha.evaluate('collaborationFixture.reconnect()')
    beta.evaluate('collaborationFixture.reconnect()')
    wait(alpha, 'collaborationFixture.snapshot().text === "!aAbcdB" && collaborationFixture.snapshot().status.pending === 0')
    wait(beta, 'collaborationFixture.snapshot().text === "!aAbcdB" && collaborationFixture.snapshot().status.pending === 0')
    if not full_scope:
        # Both offline outboxes must use actual native socket updates and receive authority ACKs after reconnect.
        for page, name in [(alpha, 'Alpha'), (beta, 'Beta')]:
            wait_for_frame(page, socket_evidence[name], 'sent', 'update', delivery_metrics[name]['sent'].get('update', 0))
            wait_for_frame(page, socket_evidence[name], 'received', 'ack', delivery_metrics[name]['received'].get('ack', 0))
            assert socket_evidence[name]['connections'] > delivery_metrics[name]['connections']
    denied_context = browser.new_context()
    denied = denied_context.new_page()
    socket_evidence['Denied'] = observe_websockets(denied)
    denied.goto(fixture_url(name='Denied', wrongToken=1))
    wait(denied, 'Boolean(window.collaborationFixture) && collaborationFixture.snapshot().status.state === "blocked"')
    rejected = denied.evaluate('collaborationFixture.snapshot()')
    assert rejected['text'] == '' and rejected['peers'] == []
    isolated_context = browser.new_context()
    isolated = isolated_context.new_page()
    socket_evidence['Isolated'] = observe_websockets(isolated)
    isolated.goto(fixture_url(name='Isolated', workspace='another'))
    ready(isolated)
    other = isolated.evaluate('collaborationFixture.snapshot()')
    assert other['text'] == '' and other['peers'] == []
    if full_scope:
        assert other['metrics']['connectedPeers'] == 0
    else:
        assert other['transport'] == 'websocket' and other['metrics'] is None
        assert socket_evidence['Denied']['received'].get('update', 0) == 0
        assert socket_evidence['Denied']['received'].get('sync-batch', 0) == 0
        assert socket_evidence['Isolated']['received'].get('update', 0) == 0
    isolated.evaluate('collaborationFixture.openSetup()')
    isolated.get_by_label('Room token', exact=True).fill('fixture-secret-only')
    isolated.get_by_role('button', name='Cancel', exact=True).click()
    wait(isolated, 'collaborationFixture.snapshot().setupCancelled === true')
    assert isolated.locator('.git-collab-setup').count() == 0
    alpha.screenshot(path=str(browser.directory / 'presence.png'))
    for page in [alpha, beta, denied, isolated]:
        page.evaluate('collaborationFixture.dispose()')
    assert alpha.locator('.git-collab-presence').count() == 0
    assert alpha.locator('.git-remote-cursors').count() == 0
    return {('directMetrics' if full_scope else 'fallbackMetrics'):
                delivery_metrics if full_scope else snapshot_evidence(socket_evidence),
            'finalText': '!aAbcdB', 'restoredActor': actor,
            'backends': ['native WebSocket'] + (['native RTCPeerConnection'] if full_scope else [])
                        + ['native IndexedDB', 'real DOM', 'Studio CodeEditor'],
            'checks': ['two-context cursors', 'backward selections', 'preserved editor callbacks', 'native typing',
                       'direct data channel' if full_scope else 'native WebSocket update delivery and ACKs',
                       'offline reload', 'outbox convergence', 'wrong-room denial',
                       'workspace isolation', 'setup cancellation', 'disposal', 'CSP']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope', choices=['full', 'websocket-fallback'], default='full',
                        help='The default requires native direct WebRTC. Fallback is separate partial-scope evidence.')
    options = parser.parse_args(argv)
    full_scope = options.scope == 'full'
    suite = Path(__file__).stem + ('' if full_scope else '_websocket_fallback')
    directory = results_dir() / suite
    directory.mkdir(parents=True, exist_ok=True)
    result = {'schemaVersion': 1, 'suite': 'SF-A25 collaboration browser', 'passed': False,
              'scope': options.scope, 'fullScope': full_scope, 'fullScopePassed': False,
              'unqualifiedChecks': [] if full_scope else ['native direct WebRTC channel and ICE/DTLS/SCTP'],
              'checks': [], 'mode': 'native loopback HTTP, ' + ('WebSocket/WebRTC' if full_scope else 'WebSocket fallback')
                                   + ', IndexedDB and Studio CodeEditor',
              'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    socket_evidence = {}
    server = None
    try:
        server, metadata = start_server()
        result['node'] = metadata['node']
        result['networkInterfaces'] = metadata['networkInterfaces']
        result['networkInterfaceDiagnostics'] = metadata['networkInterfaceDiagnostics']
        # This real local fixture also runs in containers which have only a loopback interface.
        # Chromium normally omits that interface from ICE candidate gathering.
        rtc_loopback = full_scope and selected_engine() == 'chromium'
        with sync_playwright() as playwright, launch_browser(playwright, suite, rtc_loopback=rtc_loopback) as browser:
            result.update({'browser': browser.browser.version, 'engine': browser.engine,
                           'pythonPlaywright': version('playwright'), 'cspViolations': browser.csp.events,
                           'rtcLoopback': rtc_loopback, 'launchArguments': browser.launch_configuration.get('args', [])})
            try:
                result.update(run(browser, metadata['url'], options.scope, socket_evidence))
            except BaseException:
                # Capture both live peers before the launcher closes contexts and retains traces.
                result['failureSnapshots'] = failure_snapshots(browser)
                raise
        # The launcher performs its final CSP assertion and cleanup while leaving the context manager.
        result['passed'] = True
    except BaseException:
        result['failure'] = traceback.format_exc()
        traceback.print_exc()
    finally:
        try:
            if server is not None and server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    result['serverCleanup'] = 'forced after the existing five-second shutdown deadline'
                    server.kill()
                    server.wait()
        except BaseException:
            result['passed'] = False
            result['cleanupFailure'] = traceback.format_exc()
            traceback.print_exc()
        result['completedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        result['fullScopePassed'] = full_scope and result['passed']
        result['webSocketEvidence'] = snapshot_evidence(socket_evidence)
        if 'failure' in result:
            try:
                # The launcher's context manager has now closed and finalized console.log and native traces.
                result['launcherDiagnostics'] = launcher_diagnostics(directory)
            except BaseException as error:
                result['launcherDiagnostics'] = {'status': 'capture-failed', 'errorType': type(error).__name__}
        (directory / 'qualification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
