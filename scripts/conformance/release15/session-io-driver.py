"""Production session I/O through the existing T12 browser/RPC lifecycle."""
import hashlib
import importlib.util
import importlib.metadata
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


base = module('acceptance_studio', ROOT / 'scripts/conformance/acceptance/studio-driver.py')
sys.path.insert(0, str(Path(__file__).parent))
from browser_harness import load_application
from sessions import SessionAcceptance, failure_details, require, source_revision

source = module('session_io_source', Path(__file__).with_name('session-io-source.py'))
endpoint = module('session_io_endpoint', Path(__file__).with_name('session-io-endpoint.py'))

PHASES = ('three-live-workers', 'denied-origin', 'explicit-session-grants',
          'concurrent-http-numerics', 'selected-http-cancellation',
          'selected-grant-revocation', 'revoked-session-restart')
STEP_STARTED = False


class SessionIO(SessionAcceptance):
    def __init__(self, page, output, host):
        super().__init__(page, ROOT, output)
        self.host = host
        self.gates = {}
        self.tags = {}

    def capture(self, name, **details):
        filename = 'session-io-' + name + '.png'
        self.page.screenshot(path=str(self.output / filename))
        self.checks.append({'name': name, 'status': 'passed', 'screenshot': filename, **details})

    def runtime(self, identifier):
        return self.evaluate('id => sharpforge.workbenchServices.sessions.require(id).request("runtimeInfo")', identifier)

    def button(self, identifier, name):
        node = self.node(identifier, 'SessionIO' + name)
        self.panel(identifier).locator('[data-sf-id=' + json.dumps(node['id']) + ']').click()

    def completed(self, identifier, outcome):
        tag = self.tags[identifier]
        self.wait('''() => {
          const s = sharpforge.workbenchServices.sessions.require(%s);
          return s.programOutput.includes(%s) && s.programOutput.endsWith(%s);
        }''' % (json.dumps(identifier), json.dumps(tag + ':' + outcome + '\n'), json.dumps(tag + ':done\n')))
        require(self.node(identifier, 'SessionIOStatus')['properties']['Text'] == tag + ':ready',
                'Managed completion did not reach its own application panel')

    def prepare(self):
        require(os.getenv('SHARPFORGE_IN_MEMORY') != '1', 'Session I/O requires production HTTP and real workers')
        load_application(self.page, [self.host.origin])
        records = source.records(self.host.origin)
        data = (json.dumps(records, indent=2) + '\n').encode('utf8')
        (self.output / 'session-io-source.json').write_bytes(data)
        self.evaluate('''async records => {
          for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
          await sharpforge.loadDiskRecords(records, {entry:'SessionIO.slnx', startup:'Alpha/Alpha.csproj', name:'SessionIO'});
          const services = sharpforge.workbenchServices;
          for (const [projectId, tag] of [['Alpha/Alpha.csproj','alpha'], ['Beta/Beta.csproj','beta']]) {
            services.profiles.set(projectId, {id:'default', name:'Session I/O', arguments:[tag], renderer:'dom',
              runtimeSettings:{timeoutMs:60000, compute:{workers:1, backend:tag === 'beta' ? 'auto' : 'scalar'}}});
          }
          services.startup.configure({mode:'multiple', entries:[
            {projectId:'Alpha/Alpha.csproj', action:'start', profile:'default', order:0},
            {projectId:'Beta/Beta.csproj', action:'start', profile:'default', order:1}]});
        }''', records)
        self.page.locator('#start').click()
        self.wait('''() => {const all=sharpforge.workbenchServices.sessions.list({liveOnly:true});
          return all.length===2 && all.every(s=>s.debug?.uiActive && !s.launchBusy && s.programOutput.endsWith(':started\\n'));}''',
                  timeout=60000)
        self.evaluate('''() => {
          const services=sharpforge.workbenchServices, project='Alpha/Alpha.csproj';
          services.profiles.set(project, {...services.profiles.get(project), id:'copy', arguments:['alpha-copy']});
          services.profiles.select(project,'copy');
        }''')
        self.page.locator('.sf-startup-target select[aria-label="Startup target"]').select_option(source.PROJECTS[0])
        result = self.evaluate("sharpforge.execute('start-new-instance')")
        require(len(result['started']) == 1 and not result['failed'], 'Duplicate application did not start')
        self.wait('''() => {const all=sharpforge.workbenchServices.sessions.list({liveOnly:true});
          return all.length===3 && all.every(s=>s.debug?.uiActive && !s.launchBusy && s.programOutput.endsWith(':started\\n'));}''',
                  timeout=60000)
        proof = self.evaluate('''() => {
          const services=sharpforge.workbenchServices, all=services.sessions.list({liveOnly:true});
          const compilers=['Alpha/Alpha.csproj','Beta/Beta.csproj'].map(id=>services.builds.get(id).worker.worker);
          const workers=all.map(s=>s.worker.worker);
          window.r015Sessions={ids:all.map(s=>s.id), workers:new Map(all.map(s=>[s.id,s.worker.worker])),
            panels:new Map(all.map(s=>[s.id,sharpforge.applicationWindows.panels.get(s.id)]))};
          return {productionRuntimeWorkers:workers.every(w=>w instanceof Worker), runtimeWorkers:new Set(workers).size,
            productionCompilerWorkers:compilers.every(w=>w instanceof Worker), compilerWorkers:new Set(compilers).size,
            distinctWorkerRoles:new Set([...workers,...compilers]).size===5,
            sessions:all.map(s=>({id:s.id, project:s.projectId, tag:s.lastLaunch.programArguments[0],
              identity:s.identity, workerUrl:String(s.worker.url), engine:s.resources().engine}))};
        }''')
        require(proof['distinctWorkerRoles'] and proof['productionRuntimeWorkers'] and proof['runtimeWorkers'] == 3
                and proof['productionCompilerWorkers'] and proof['compilerWorkers'] == 2, 'Production worker identities are missing')
        self.tags = {row['id']: row['tag'] for row in proof['sessions']}
        require(set(self.tags.values()) == set(source.TAGS), 'Launch arguments crossed session boundaries')
        self.ids = [next(identifier for identifier, tag in self.tags.items() if tag == expected) for expected in source.TAGS]
        self.target, self.monitor, self.duplicate = self.ids
        assets = self.evaluate('''async () => {
          const result = {};
          for (const path of ['studio.js','compiler.worker.js','runtime.worker.js']) {
            const response = await fetch(new URL(path,location.href));
            if (!response.ok) throw new Error('Required served asset is missing: ' + path);
            const digest = await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
            result[path] = [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
          }
          return result;
        }''')
        self.capture(PHASES[0], **proof, servedAssets=assets,
                     sourceSha256=hashlib.sha256(data).hexdigest(), source='session-io-source.json')

    def deny(self):
        before = self.snapshot()
        self.button(self.target, 'Work')
        self.completed(self.target, 'http-failed')
        metrics = self.runtime(self.target)
        require(not self.host.snapshot() and metrics['network']['requests'] == 0 and metrics['pendingExternal'] == 0,
                'Ungranted managed HTTP reached an endpoint or retained a host operation')
        require(metrics['compute']['completed'] == 1, 'Origin denial stopped unrelated numerical work')
        self.assert_others(before, self.target)
        self.capture(PHASES[1], sessionId=self.target, runtime=metrics, endpointRequests=0)

    def restart_session(self, identifier):
        before = self.snapshot()
        previous = next(row for row in before if row['id'] == identifier)
        self.select(identifier)
        self.page.locator('#restart').click()
        self.wait('''() => {const s=sharpforge.workbenchServices.sessions.require(%s);
          return s.debug?.uiActive && !s.launchBusy && s.programOutput===%s;}'''
                  % (json.dumps(identifier), json.dumps(self.tags[identifier] + ':started\n')), timeout=60000)
        after = next(row for row in self.snapshot() if row['id'] == identifier)
        require(after['identity'] != previous['identity'] and not after['sameWorker'], 'Restart retained the old runtime worker')
        self.assert_others(before, identifier)
        self.evaluate('id => r015Sessions.workers.set(id,sharpforge.workbenchServices.sessions.require(id).worker.worker)', identifier)

    def grants(self):
        for identifier in self.ids:
            before = self.snapshot()
            self.settings_target(identifier)
            self.page.locator('#runtime-network').check()
            self.page.locator('#runtime-origins').fill(self.host.origin)
            self.page.locator('#runtime-apply').click()
            self.wait('sharpforge.workbenchServices.settings.get(%s).allowedOrigins[0]===%s'
                      % (json.dumps(identifier), json.dumps(self.host.origin)))
            session = next(row for row in self.snapshot() if row['id'] == identifier)
            require(session['activeGrants']['network']['allowedOrigins'] == [], 'Settings silently changed active runtime grants')
            self.assert_others(before, identifier)
            self.restart_session(identifier)
        snapshots = self.snapshot()
        require(all(row['activeGrants']['network']['allowedOrigins'] == [self.host.origin] for row in snapshots),
                'Explicit grants were not bound to each restarted runtime')
        self.capture(PHASES[2], sessions=snapshots, endpoint=self.host.origin)

    def concurrent(self):
        self.gates = self.host.arm(source.TAGS)
        for identifier in self.ids:
            self.button(identifier, 'Work')
        for tag in source.TAGS:
            self.host.wait(tag)
        for identifier in self.ids:
            self.wait('sharpforge.workbenchServices.sessions.require(%s).programOutput.endsWith(%s)'
                      % (json.dumps(identifier), json.dumps(self.tags[identifier] + ':sum:2048\n')))
        runtimes = {identifier: self.runtime(identifier) for identifier in self.ids}
        require(all(value['compute']['completed'] == 1 and len(value['compute']['slots']) == 1
                    and value['compute']['slots'][0] and value['network']['active'] == 1
                    and value['pendingExternal'] == 1 for value in runtimes.values()),
                'The three managed HTTP windows did not overlap real per-session numerical completion')
        require(all(not row.get('cookiePresent') and not row.get('authorizationPresent') for row in self.host.snapshot()),
                'A managed loopback request included ambient credentials')
        self.capture(PHASES[3], runtimes=runtimes, requests=self.host.snapshot(),
                     scope='Concurrent held HTTP requests with completed real numerical worker jobs; no global fairness budget claim')

    def cancel_http(self):
        before = self.snapshot()
        self.button(self.target, 'Cancel')
        self.completed(self.target, 'http-failed')
        runtime = self.runtime(self.target)
        require(runtime['network']['canceled'] == 1 and runtime['network']['active'] == 0
                and runtime['pendingExternal'] == 0, 'Managed cancellation retained an active request')
        self.assert_others(before, self.target)
        self.gates['alpha'].set()
        self.host.wait('alpha', ('responded', 'disconnected'))
        self.capture(PHASES[4], sessionId=self.target, runtime=runtime, sessions=self.snapshot())

    def revoke(self):
        before = self.snapshot()
        self.settings_target(self.monitor)
        self.select(self.duplicate)
        require(self.page.locator('#runtime-target').input_value() == 'session:' + self.monitor,
                'Changing the debugger changed the explicit grant target')
        self.page.locator('#runtime-revoke').click()
        self.wait('sharpforge.workbenchServices.sessions.require(%s).state==="stopped"' % json.dumps(self.monitor))
        self.wait('''async () => (await sharpforge.workbenchServices.sessions.require(%s).request('runtimeInfo')).pendingExternal===0'''
                  % json.dumps(self.monitor))
        self.wait('''async () => (await sharpforge.workbenchServices.sessions.require(%s).request('runtimeInfo')).network.active===0'''
                  % json.dumps(self.monitor))
        settings = self.evaluate('id => sharpforge.workbenchServices.settings.get(id)', self.monitor)
        require(not settings['enabled'] and settings['allowedOrigins'] == [], 'Revocation retained launch grants')
        self.assert_others(before, self.monitor)
        self.gates['beta'].set()
        self.host.wait('beta', ('responded', 'disconnected'))
        self.gates['alpha-copy'].set()
        self.completed(self.duplicate, 'http:alpha-copy')
        self.host.wait('alpha-copy', ('responded',))
        runtime = self.runtime(self.duplicate)
        require(runtime['network']['completed'] == 1 and runtime['pendingExternal'] == 0,
                'Another application could not complete after targeted revocation')
        self.capture(PHASES[5], revokedSession=self.monitor, activeDebugger=self.duplicate,
                     revokedRuntime=self.runtime(self.monitor), survivingRuntime=runtime, sessions=self.snapshot())

    def denied_restart(self):
        requests = self.host.snapshot()
        self.restart_session(self.monitor)
        before = self.snapshot()
        self.button(self.monitor, 'Work')
        self.completed(self.monitor, 'http-failed')
        runtime = self.runtime(self.monitor)
        require(self.host.snapshot() == requests and runtime['network']['requests'] == 0
                and runtime['compute']['completed'] == 1 and runtime['pendingExternal'] == 0,
                'A restarted application restored revoked grants or lost numerical work')
        self.assert_others(before, self.monitor)
        for identifier in self.ids:
            self.button(identifier, 'Ping')
            self.wait('sharpforge.workbenchServices.sessions.require(%s).programOutput.endsWith(%s)'
                      % (json.dumps(identifier), json.dumps(self.tags[identifier] + ':tick:1\n')))
        snapshots = self.snapshot()
        for row in snapshots:
            require(all(line.startswith(self.tags[row['id']] + ':') for line in row['output'].splitlines()),
                    'A late callback or output record crossed application identities')
        self.capture(PHASES[6], deniedRuntime=runtime, sessions=snapshots)


def session_io(page):
    host = endpoint.Endpoint()
    suite = SessionIO(page, base.OUTPUT, host)
    browser = page.context.browser
    report = {'schemaVersion': 1, 'kind': 'release15-session-io', 'componentStatus': 'running',
              'source': source_revision(ROOT), 'browser': {'name': browser.browser_type.name, 'version': browser.version},
              'checks': suite.checks, 'unexecutedPhases': [], 'cleanup': {'status': 'pending'}}
    path = base.OUTPUT / 'session-io-observations.json'
    flush = lambda: path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    phases = (suite.prepare, suite.deny, suite.grants, suite.concurrent, suite.cancel_http, suite.revoke, suite.denied_restart)
    try:
        for name, operation in zip(PHASES, phases):
            report['activePhase'] = name
            flush()
            operation()
        report.pop('activePhase', None)
        report['componentStatus'] = 'passed'
    except BaseException as error:
        report['componentStatus'] = 'failed'
        report['failure'] = failure_details(error)
        raise
    finally:
        report['unexecutedPhases'] = [name for name in PHASES if not any(row['name'] == name for row in suite.checks)]
        cleanup_errors = []
        try:
            suite.evaluate("sharpforge.execute('stop-all')")
            suite.wait('sharpforge.workbenchServices.sessions.list({liveOnly:true}).length===0')
        except BaseException as error:
            cleanup_errors.append(failure_details(error))
        try:
            host.close(suite.gates)
        except BaseException as error:
            cleanup_errors.append(failure_details(error))
        if cleanup_errors:
            report['componentStatus'] = 'failed'
            report['cleanup'] = {'status': 'failed', 'errors': cleanup_errors}
        else:
            report['cleanup'] = {'status': 'passed', 'liveApplications': 0, 'endpointStopped': not host.thread.is_alive()}
        report['endpointEvents'] = host.snapshot()
        flush()
        if cleanup_errors:
            raise RuntimeError('Session I/O cleanup failed; retained observations include each error')
    return report


def dispatch(page, step):
    global STEP_STARTED
    if step['action'] != 'session-io':
        raise ValueError('Unsupported session I/O action')
    STEP_STARTED = True
    return session_io(page)


def record_driver_failure(error):
    engine = os.getenv('SHARPFORGE_BROWSER_ENGINE', 'chromium')
    message = str(error)[:16384]
    unavailable = not STEP_STARTED and (
        (message.startswith('BrowserType.launch:') and ("Executable doesn't exist" in message
                                                       or 'Host system is missing dependencies' in message))
        or message.startswith(engine.upper() + '_EXECUTABLE is not a file:'))
    record = {'schemaVersion': 1, 'kind': 'session-io-driver-failure', 'status': 'unavailable' if unavailable else 'failed',
              'stage': 'browser-setup' if not STEP_STARTED else 'browser-teardown',
              'engine': engine, 'playwright': importlib.metadata.version('playwright'),
              'configuredExecutable': os.getenv(engine.upper() + '_EXECUTABLE') or 'playwright-managed',
              'componentExecuted': STEP_STARTED, 'message': message}
    (base.OUTPUT / 'session-io-driver-failure.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    try:
        base.main(dispatch)
    except BaseException as error:
        record_driver_failure(error)
        raise
