"""Actual Clone Repository dialog interactions and independent native-object comparisons."""
from urllib.parse import urlsplit
import sys

import browser_harness
from browser_harness import wait_condition
from a25_clone_diagnostics import clone_submission
from a25_clone_events import CloneNetworkEvents, expected_authentication_cancellations


FIXTURE_TOKEN = 'sharpforge-local-clone-fixture-only'

READ_CLONE = """async () => {
    const saved = JSON.parse(localStorage.getItem('sharpforge.git.repositories.v1'))?.repositories;
    if (!Array.isArray(saved) || saved.length !== 1) throw new Error('Expected one isolated cloned repository');
    const repository = saved[0];
    const { GitWorkerClient } = await __sharpforgeTestImport('/packages/git/src/index.js');
    const worker = new Worker(new URL('./git-worker.js', location.href), {type: 'module'});
    const client = new GitWorkerClient(worker);
    const request = (method, params = {}) => client.request(method, {repositoryId: repository.repositoryId, ...params});
    try {
        const opened = await request('open', repository);
        const head = await request('head');
        const commits = await request('log', {maxCount: 2});
        const status = await request('status');
        const remotes = await request('remotes');
        const files = await request('files');
        return {opened, head, status, remotes, commits,
            records: Object.fromEntries(files.map(file => [file.path, new TextDecoder().decode(file.data)]))};
    } finally {
        try { await client.dispose(); }
        finally { worker.terminate(); }
    }
}"""


def require(value, message):
    if not value:
        raise AssertionError(message)


class CloneWorkflow:
    def __init__(self, browser, fixture, report, directory):
        self.browser, self.fixture, self.report, self.directory = browser, fixture, report, directory
        self.metadata = fixture.metadata

    def open_page(self, name, *, accept_grant=True):
        # Only this isolated loopback context accepts the repository's public test certificate.
        context = self.browser.new_context(viewport={'width': 1600, 'height': 1100}, ignore_https_errors=True)
        page = context.new_page()
        page.set_default_timeout(30000)
        events = {'case': name, 'dialogs': [], 'workers': [], 'workerPolicies': [],
                  'pageErrors': [], 'requestFailures': [], 'unexpectedOrigins': []}
        self.report['observations'].append(events)
        network_events = CloneNetworkEvents(events, self.metadata['remote'])
        page.on('pageerror', lambda error: events['pageErrors'].append(error.stack or str(error)))
        page.on('worker', lambda worker: events['workers'].append(worker.url))
        context.on('requestfailed', network_events.failure)

        def request_started(request):
            parsed = urlsplit(request.url)
            origin = parsed.scheme + '://' + parsed.netloc
            if parsed.scheme in ('http', 'https') and origin not in (self.metadata['studio'], self.metadata['remote']):
                events['unexpectedOrigins'].append(origin)

        def response_received(response):
            network_events.response(response)
            if urlsplit(response.url).path == '/git-worker.js':
                events['workerPolicies'].append({'url': response.url, 'status': response.status,
                                                'csp': response.headers.get('content-security-policy', '')})

        def dialog_opened(dialog):
            grant = dialog.type == 'confirm' and dialog.message == (
                'Allow this Git remote to connect to:\n' + self.metadata['remote'] + '?')
            replacement = dialog.type == 'confirm' and dialog.message.startswith('Load the selected Git worktree into Studio?')
            accepted = (grant and accept_grant) or replacement
            events['dialogs'].append({'message': dialog.message, 'grant': grant, 'accepted': accepted, 'expected': grant or replacement})
            dialog.accept() if accepted else dialog.dismiss()

        context.on('request', request_started)
        context.on('response', response_received)
        page.on('dialog', dialog_opened)
        response = page.goto(self.metadata['studio'] + '/', wait_until='load')
        require(response is not None and response.status == 200, 'Built Studio navigation failed')
        policy = response.headers.get('content-security-policy', '')
        require("script-src 'self'" in policy and "'unsafe-eval'" not in policy, 'Production script CSP was not retained')
        require(self.metadata['remote'] in policy, 'Production CSP did not grant the exact loopback Git remote')
        events['csp'] = policy
        wait_condition(page, 'Boolean(window.sharpforge && sharpforge.getState().metrics)', timeout=60000)
        complete_startup = getattr(browser_harness, 'complete_startup', None)
        if complete_startup is not None:
            complete_startup(page)
        page.evaluate('sharpforge.execute("stop")')
        return context, page, events

    def dialog(self, page, url):
        native_menu = page.locator('.menubar [role="menubar"]')
        if native_menu.count():
            native_menu.get_by_role('menuitem', name='Git', exact=True).click()
        else:
            page.locator('.menubar [data-menu="git"]').click()
        page.get_by_role('menuitem', name='Clone Repository…', exact=True).click()
        dialog = page.get_by_role('dialog', name='Clone Repository', exact=True)
        dialog.get_by_label('Repository HTTPS URL', exact=True).fill(url)
        return dialog

    def assert_clean(self, events, *, authenticated_remote=None, server_requests=()):
        require(not events['pageErrors'], 'Browser emitted a page error: ' + repr(events['pageErrors']))
        expected = expected_authentication_cancellations(events, authenticated_remote, server_requests)
        events['expectedRequestCancellations'] = expected
        accepted = {item['failureIndex'] for item in expected}
        unexpected = [failure for index, failure in enumerate(events['requestFailures']) if index not in accepted]
        require(not unexpected, 'Browser emitted an unexpected failed request: ' + repr(unexpected))
        require(not events['unexpectedOrigins'], 'Clone connected outside the explicit fixture origins')
        require(all(dialog['expected'] for dialog in events['dialogs']), 'Studio showed an unexpected native dialog')
        require(any(url.endswith('/git-worker.js') for url in events['workers']), 'No actual Git worker was observed')
        require(events['workerPolicies'], 'The actual Git worker response policy was not observed')
        for worker in events['workerPolicies']:
            directives = [part.strip().split() for part in worker['csp'].split(';')]
            connections = next((part[1:] for part in directives if part and part[0] == 'connect-src'), [])
            require(worker['status'] == 200 and self.metadata['remote'] in connections,
                    'The Git worker response did not allow the exact fixture remote: ' + repr(worker))

    def assert_loaded(self, page, remote):
        wait_condition(page, """() => {
            const indicator = document.querySelector('.git-status-indicator');
            return indicator?.title === 'main: 0 changed files; open Git Changes to sync'
                && !document.querySelector('[data-tool="git-changes"][aria-busy="true"]');
        }""", timeout=120000)
        state = page.evaluate('sharpforge.getState()')
        require(state['project']['solution']['path'] == self.metadata['solution'], 'Clone did not load the actual solution')
        require(state['startupProject'] == self.metadata['project'], 'Clone did not choose the solution startup project')
        require([project['path'] for project in state['project']['projects']] == [self.metadata['project']],
                'Loaded project graph differs from the native repository')
        require({file['uri']: file['text'] for file in state['files']} == {
            self.metadata['source']: self.metadata['records'][self.metadata['source']]
        }, 'Clone did not adopt the exact native C# source')
        page.evaluate('path => sharpforge.openFile(path)', self.metadata['source'])
        editor = page.locator('[data-source-uri="' + self.metadata['source'] + '"] .sf-input')
        editor.focus()
        editor.press('ControlOrMeta+a')
        expected = self.metadata['records'][self.metadata['source']]
        selection = editor.evaluate('''(input, text) => ({
            start: input.selectionStart, end: input.selectionEnd, length: text.length
        })''', expected)
        require(selection['start'] == 0 and selection['end'] == selection['length'], 'The editor did not select the complete cloned source')
        require(editor.input_value() == expected, 'Selected editor input context differs from native Git')
        cloned = page.evaluate(READ_CLONE)
        require(cloned['opened']['backend'] == 'indexeddb', 'Clone did not persist through actual IndexedDB')
        require(cloned['head'] == {'ref': 'refs/heads/main', 'oid': self.metadata['oid']}, 'Clone changed the native canonical commit ID')
        require(len(cloned['commits']) == 1 and cloned['commits'][0]['tree'] == self.metadata['tree'],
                'Clone did not retain the canonical native tree/history')
        require(cloned['records'] == self.metadata['records'], 'Worker worktree bytes differ from the native repository')
        require(cloned['status'] == [], 'Fresh canonical clone is not clean')
        require(any(item['name'] == 'origin' and item['url'] == remote for item in cloned['remotes']), 'Clone lost its remote identity')
        stored = page.evaluate('JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])')
        require(FIXTURE_TOKEN not in stored, 'The authentication token entered Web Storage')
        return {'head': cloned['head'], 'tree': cloned['commits'][0]['tree'], 'solution': state['project']['solution']['path'],
                'startupProject': state['startupProject'], 'records': sorted(cloned['records']), 'backend': cloned['opened']['backend']}

    def public_clone(self):
        context, page, events = self.open_page('public')
        start = len(self.fixture.requests())
        try:
            dialog = self.dialog(page, self.metadata['public'].replace('https:', 'http:', 1))
            dialog.get_by_role('button', name='Clone', exact=True).click()
            dialog.get_by_role('alert').filter(has_text='Git network URLs must use HTTPS').wait_for()
            require(len(self.fixture.requests()) == start, 'An insecure URL reached the Git server')
            dialog.get_by_label('Repository HTTPS URL', exact=True).fill(self.metadata['public'])
            dialog.get_by_label('Branch (remote default when empty)', exact=True).fill('main')
            with clone_submission(page, dialog) as wait:
                wait()
            loaded = self.assert_loaded(page, self.metadata['public'])
            require(page.get_by_role('dialog', name='Git authentication', exact=True).count() == 0, 'Public clone requested authentication')
            rows = self.fixture.requests()[start:]
            require(any(row['method'] == 'OPTIONS' and row['status'] == 204 for row in rows), 'Native browser CORS preflight was not observed')
            require(any(row['path'].endswith('/git-upload-pack') and row['forwarded'] and row['status'] == 200 for row in rows),
                    'Public clone did not receive actual native Git protocol responses')
            require(all(not row['authorizationPresent'] for row in rows), 'Public clone sent a credential')
            require(any(item['grant'] and item['accepted'] for item in events['dialogs']), 'Public clone bypassed the visible origin grant')
            self.assert_clean(events)
            page.screenshot(path=str(self.directory / 'public-clone.png'))
            return {**loaded, 'httpsBoundary': 'rejected before network', 'requests': rows}
        finally:
            if sys.exc_info()[0] is None:
                page.close()

    def private_clone(self):
        context, page, events = self.open_page('private')
        start = len(self.fixture.requests())
        try:
            dialog = self.dialog(page, self.metadata['private'])
            dialog.get_by_label('Provider', exact=True).select_option('gitea')
            with clone_submission(page, dialog) as wait:
                wait(authentication=True)
                authentication = page.get_by_role('dialog', name='Git authentication', exact=True)
                challenged = self.fixture.requests()[start:]
                require(any(row['status'] == 401 and not row['authorizationPresent'] for row in challenged),
                        'The real private repository did not challenge the initial anonymous request')
                require(not any(row['forwarded'] for row in challenged), 'Private Git data was disclosed before authentication')
                authentication.get_by_label('Personal access token', exact=True).fill(FIXTURE_TOKEN)
                authentication.get_by_role('button', name='Sign in with token', exact=True).click()
                authentication.wait_for(state='hidden')
                wait()
            loaded = self.assert_loaded(page, self.metadata['private'])
            rows = self.fixture.requests()[start:]
            successful = [row for row in rows if row['forwarded']]
            require(successful and all(row['authenticated'] and row['authorizationPresent'] and row['status'] == 200 for row in successful),
                    'Private clone retry did not authenticate every native Git request')
            require(any(row['path'].endswith('/git-upload-pack') for row in successful), 'Authenticated retry never fetched native objects')
            require(any(item['grant'] and item['accepted'] for item in events['dialogs']), 'Private clone bypassed the visible origin grant')
            self.assert_clean(events, authenticated_remote=self.metadata['private'], server_requests=rows)
            page.screenshot(path=str(self.directory / 'private-clone.png'))
            return {**loaded, 'authentication': 'native 401, visible token dialog, automatic authenticated retry', 'requests': rows}
        finally:
            if sys.exc_info()[0] is None:
                page.close()

    def declined_grant(self):
        context, page, events = self.open_page('declined-grant', accept_grant=False)
        start = len(self.fixture.requests())
        before = page.evaluate('sharpforge.getState().files')
        try:
            dialog = self.dialog(page, self.metadata['public'])
            dialog.get_by_role('button', name='Clone', exact=True).click()
            dialog.get_by_role('alert').filter(has_text='Remote connection grant cancelled').wait_for()
            require(len(self.fixture.requests()) == start, 'Declining a connection grant still contacted the remote')
            require(page.evaluate('sharpforge.getState().files') == before, 'Declining a clone grant changed the open workspace')
            require(any(item['grant'] and not item['accepted'] for item in events['dialogs']), 'The connection grant was not declined')
            dialog.get_by_role('button', name='Cancel', exact=True).click()
            self.assert_clean(events)
            return {'networkRequests': 0, 'workspacePreserved': True, 'grant': 'declined in the native dialog'}
        finally:
            if sys.exc_info()[0] is None:
                page.close()
