"""R015: three simultaneous applications in production Studio and real Workers.

This adapter uses the existing browser/RPC lifecycle. It never installs a mock
workbench, Worker, event receiver, renderer, or replacement application host.
"""
import json
import os
from urllib.parse import urlparse

from browser_harness import wait_condition


DASHBOARD = 'Dashboard/Dashboard.csproj'
MONITOR = 'Monitor/Monitor.csproj'
SOURCE = 'Dashboard/View.cs'
PROCESS = '.sf-debug-location-toolbar select[aria-label="Process"]'


def require(value, message):
    if not value:
        raise AssertionError(message)


class SessionAcceptance:
    def __init__(self, page, root, output):
        self.page, self.root, self.output = page, root, output
        self.ids, self.names, self.counts, self.lines = [], {}, {}, {}
        self.checks = []
        self.increment = 1

    def evaluate(self, code, arg=None):
        return self.page.evaluate(code, arg)

    def wait(self, predicate, timeout=30000):
        wait_condition(self.page, predicate, timeout=timeout)

    def capture(self, name, status='passed', **details):
        filename = 'sessions-' + name + '.png'
        self.page.screenshot(path=str(self.output / filename))
        self.checks.append({'name': name, 'status': status, 'screenshot': filename, **details})

    def select(self, identifier):
        self.page.locator(PROCESS).select_option(identifier)
        value = self.evaluate('''() => {
          const sessions = sharpforge.workbenchServices.sessions, active = sessions.active;
          return {id: sessions.activeId, app: sharpforge.getState().debug?.appId,
            identity: active?.identity, debugIdentity: sharpforge.getState().debug?.sessionId};
        }''')
        require(value['id'] == identifier and value['app'] == identifier and
                value['identity'] == value['debugIdentity'], 'Process selector cross-routed the debugger')

    def snapshot(self):
        return self.evaluate('''async () => {
          const services = sharpforge.workbenchServices;
          return await Promise.all(r015Sessions.ids.map(async id => {
            const session = services.sessions.require(id);
            const panel = sharpforge.applicationWindows.panels.get(id);
            return {id, project: session.projectId, identity: session.identity, live: session.live,
              state: session.state, uiActive: session.debug?.uiActive, output: session.programOutput,
              version: session.debug?.codeVersion ?? 0, channel: services.output.get(session.channelId),
              sameWorker: session.worker.worker === r015Sessions.workers.get(id),
              samePanel: panel === r015Sessions.panels.get(id),
              settings: services.settings.get(id), activeGrants: session.activeRuntimeSettings,
              scene: session.live ? await session.request('uiScene') : null};
          }));
        }''')

    def assert_others(self, before, except_id):
        after = {row['id']: row for row in self.snapshot()}
        for old in before:
            if old['id'] == except_id:
                continue
            new = after[old['id']]
            for key in ('identity', 'output', 'version', 'settings', 'activeGrants', 'scene', 'live', 'state', 'uiActive'):
                require(new[key] == old[key], f"Other application {old['id']} changed {key}")
            require(new['sameWorker'] and new['samePanel'], f"Other application {old['id']} was replaced")

    def panel(self, identifier):
        self.evaluate('id => sharpforge.openTool("app:" + id)', identifier)
        panel = self.page.locator('[data-app-session=' + json.dumps(identifier) + ']')
        panel.wait_for(state='visible')
        return panel

    def node(self, identifier, name):
        nodes = self.evaluate('''async id =>
          (await sharpforge.workbenchServices.sessions.require(id).request('uiScene')).nodes''', identifier)
        matches = [node for node in nodes if node['properties'].get('Name') == name]
        require(len(matches) == 1, f'{identifier}: expected one managed control {name}')
        return matches[0]

    def click(self, identifier, amount=1):
        name = self.names[identifier]
        before = self.snapshot()
        node = self.node(identifier, name + 'Action')
        self.panel(identifier).locator('[data-sf-id=' + json.dumps(node['id']) + ']').click()
        self.counts[identifier] += amount
        self.lines[identifier].append(name.lower() + '-count:' + str(self.counts[identifier]))
        expected = '\n'.join(self.lines[identifier]) + '\n'
        self.wait('''() => sharpforge.workbenchServices.sessions.require(%s).programOutput === %s'''
                  % (json.dumps(identifier), json.dumps(expected)))
        status = self.node(identifier, name + 'Status')
        require(status['properties']['Text'] == name + ':' + str(self.counts[identifier]),
                'Managed callback updated the wrong instance counter')
        require(name + ':' + str(self.counts[identifier]) in self.panel(identifier).inner_text(),
                'Managed state did not reach its actual application panel')
        self.assert_others(before, identifier)

    def prepare(self):
        require(os.getenv('SHARPFORGE_IN_MEMORY') != '1' and urlparse(self.page.url).scheme in ('http', 'https'),
                'Multi-session acceptance requires served production Studio and real worker URLs')
        self.wait('!!sharpforge.workbenchShell && !!sharpforge.workbenchServices')
        self.evaluate('''async () => {
          for (let turn = 0; turn < 5; turn++) {
            for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
            await Promise.resolve();
          }
        }''')
        directory = self.root / 'tests/conformance/release15/fixtures'
        records = [{'path': path.relative_to(directory).as_posix(), 'text': path.read_text(encoding='utf8')}
                   for path in sorted(directory.rglob('*')) if path.is_file()]
        self.original = next(record['text'] for record in records if record['path'] == SOURCE)
        self.evaluate('''async records => {
          await sharpforge.loadDiskRecords(records, {entry: 'Release15.slnx',
            startup: 'Dashboard/Dashboard.csproj', name: 'Release15'});
          const services = sharpforge.workbenchServices;
          for (const projectId of ['Dashboard/Dashboard.csproj', 'Monitor/Monitor.csproj']) {
            services.profiles.set(projectId, {id: 'default', name: 'Acceptance', renderer: 'dom', stopOnEntry: false});
          }
          services.startup.configure({mode: 'multiple', entries: [
            {projectId: 'Dashboard/Dashboard.csproj', action: 'start', profile: 'default', order: 0},
            {projectId: 'Monitor/Monitor.csproj', action: 'start', profile: 'default', order: 1}
          ]});
        }''', records)
        self.page.locator('#start').click()
        self.wait('''() => {
          const sessions = sharpforge.workbenchServices.sessions.list({liveOnly: true});
          return sessions.length === 2 && sessions.every(s => s.debug?.uiActive && !s.launchBusy &&
            s.programOutput.endsWith('-started\\n'));
        }''', timeout=60000)
        initial = self.evaluate('''() => sharpforge.workbenchServices.sessions.list({liveOnly: true})
          .map(session => ({id: session.id, project: session.projectId}))''')
        self.target = next(row['id'] for row in initial if row['project'] == DASHBOARD)
        self.monitor = next(row['id'] for row in initial if row['project'] == MONITOR)
        self.page.locator('.sf-startup-target select[aria-label="Startup target"]').select_option(DASHBOARD)
        result = self.evaluate("sharpforge.execute('start-new-instance')")
        require(result and len(result['started']) == 1 and not result['failed'], 'Duplicate Dashboard launch failed')
        self.duplicate = result['started'][0]
        self.ids = [self.target, self.monitor, self.duplicate]
        self.names = dict(zip(self.ids, ['Dashboard', 'Monitor', 'Dashboard']))
        self.wait('''() => {
          const sessions = sharpforge.workbenchServices.sessions.list({liveOnly: true});
          return sessions.length === 3 && sessions.every(s => s.debug?.uiActive && !s.launchBusy &&
            s.programOutput.endsWith('-started\\n'));
        }''', timeout=60000)
        bindings = self.evaluate('''ids => {
          const services = sharpforge.workbenchServices, sessions = ids.map(id => services.sessions.require(id));
          const compilerWorkers = ['Dashboard/Dashboard.csproj', 'Monitor/Monitor.csproj']
            .map(id => services.builds.get(id).worker.worker);
          const urls = sessions.map(s => String(s.worker.url));
          if (!sessions.every(s => s.worker.worker instanceof Worker) ||
              !compilerWorkers.every(worker => worker instanceof Worker) ||
              new Set(sessions.map(s => s.worker.worker)).size !== 3 || new Set(compilerWorkers).size !== 2 ||
              urls.some(url => !['http:', 'https:'].includes(new URL(url, location.href).protocol))) {
            throw new Error('Acceptance did not reach distinct production Workers');
          }
          window.r015Sessions = {ids, workers: new Map(sessions.map(s => [s.id, s.worker.worker])),
            panels: new Map(sessions.map(s => [s.id, sharpforge.applicationWindows.panels.get(s.id)]))};
          return {workerURLs: urls, identities: sessions.map(s => s.identity),
            channels: sessions.map(s => s.channelId)};
        }''', self.ids)
        require(len(set(bindings['identities'])) == 3 and len(set(bindings['channels'])) == 3,
                'Applications share runtime identities or output channels')
        for identifier in self.ids:
            self.counts[identifier] = 0
            self.lines[identifier] = [self.names[identifier].lower() + '-started']
            row = next(row for row in self.snapshot() if row['id'] == identifier)
            require(row['channel']['sessionId'] == identifier and row['channel']['projectId'] == row['project'],
                    'Output channel belongs to another app or project')
            self.click(identifier)
        self.capture('three-live-applications', **bindings)

    def debugger(self):
        # Source breakpoints intentionally belong to a project. Mute the duplicate
        # through its selected debugger, then prove it remains usable while A pauses.
        self.select(self.duplicate)
        self.evaluate('sharpforge.configureDebug({breakpointsEnabled:false})')
        self.select(self.target)
        self.evaluate('sharpforge.configureDebug({breakpointsEnabled:true})')
        line = next(index for index, text in enumerate(self.original.splitlines(), 1) if 'count += Step();' in text)
        self.evaluate('p => sharpforge.setBreakpoints(p.uri,[{line:p.line}])', {'uri': SOURCE, 'line': line})
        before = self.snapshot()
        button = self.node(self.target, 'DashboardAction')
        self.panel(self.target).locator('[data-sf-id=' + json.dumps(button['id']) + ']').click()
        self.wait('sharpforge.workbenchServices.sessions.require(%s).state === "paused"' % json.dumps(self.target))
        self.select(self.target)
        self.assert_others(before, self.target)
        value = self.evaluate('sharpforge.evaluate("count")')
        require(str(value.get('result')) == str(self.counts[self.target]), 'Evaluation read another instance state')
        for identifier in (self.monitor, self.duplicate):
            self.click(identifier)
        self.select(self.target)
        instructions = self.evaluate('sharpforge.getState().debug.stats.instructions')
        self.evaluate('sharpforge.step("next")')
        self.wait('sharpforge.getState().debug.state === "paused" && sharpforge.getState().debug.stats.instructions > %d'
                  % instructions)
        stepped = self.evaluate('sharpforge.evaluate("count")')
        require(str(stepped.get('result')) == str(self.counts[self.target] + 1), 'Step affected another frame or instance')
        self.evaluate('p => sharpforge.setBreakpoints(p,[])', SOURCE)
        self.evaluate('sharpforge.debug()')
        self.counts[self.target] += 1
        self.lines[self.target].append('dashboard-count:' + str(self.counts[self.target]))
        expected = '\n'.join(self.lines[self.target]) + '\n'
        self.wait('sharpforge.workbenchServices.sessions.require(%s).programOutput === %s'
                  % (json.dumps(self.target), json.dumps(expected)))
        self.capture('selected-debugger', evaluated=value, stepped=stepped)

    def hot_reload(self):
        self.select(self.target)
        self.page.locator('.sf-startup-target select[aria-label="Startup target"]').select_option(DASHBOARD)
        self.evaluate('p => sharpforge.openFile(p)', SOURCE)
        self.evaluate('sharpforge.beginHotReload()')
        editor = self.page.locator('[data-source-uri=' + json.dumps(SOURCE) + '] .sf-input')
        if not editor.is_editable():
            locked = self.evaluate('''() => {
              const services = sharpforge.workbenchServices;
              return {documentReadOnly: services.documents.models.get('Dashboard/View.cs').readOnly,
                sessions: services.sessions.list({projectId:'Dashboard/Dashboard.csproj'}).map(s =>
                  ({id:s.id,live:s.live,hotEdit:s.hotEdit,readOnly:s.readOnly}))};
            }''')
            self.evaluate('sharpforge.cancelHotReload()')
            require(locked['documentReadOnly'] and any(s['hotEdit'] for s in locked['sessions']) and
                    any(s['live'] and s['readOnly'] for s in locked['sessions']),
                    'Hot Reload editor is unavailable for an unrecognized reason')
            self.capture('selected-hot-reload', status='blocked', blocker='MULTI-APP', observed=locked,
                         reason='The other live instance keeps the shared project document read-only. '
                                'No model unlock, source injection or duplicate stop is substituted.')
            return
        require(self.original.count('return 1;') == 1, 'Hot Reload fixture literal is ambiguous')
        editor.fill(self.original.replace('return 1;', 'return 3;'))
        before = self.snapshot()
        self.evaluate('sharpforge.applyHotReload()')
        self.wait('sharpforge.workbenchServices.sessions.require(%s).debug.codeVersion === 1' % json.dumps(self.target))
        self.increment = 3
        self.assert_others(before, self.target)
        self.click(self.target, amount=self.increment)
        self.click(self.monitor)
        self.click(self.duplicate)
        self.capture('selected-hot-reload', codeVersion=1)

    def designer(self):
        self.select(self.target)
        self.evaluate('sharpforge.designer.open()')
        self.evaluate('sharpforge.designer.attach()')
        self.evaluate('''() => {
          const node = sharpforge.designer.get().document.nodes.find(n => n.properties.Name === 'DashboardAction');
          if (!node) throw new Error('Attached designer missed DashboardAction');
          sharpforge.designer.select(node.id); sharpforge.designer.set('Width', 250);
        }''')
        before = self.snapshot()
        self.select(self.monitor)
        rejected = self.evaluate('''async () => {
          try { await sharpforge.designer.apply(); return null; }
          catch (error) { return error.message; }
        }''')
        require(rejected and 'session' in rejected.lower(), 'Designer applied a previous app attachment to another process')
        self.assert_others(before, None)
        self.select(self.target)
        self.evaluate('sharpforge.designer.apply()')
        require(self.node(self.target, 'DashboardAction')['properties']['Width'] == 250, 'Designer did not patch selected app')
        self.assert_others(before, self.target)
        self.click(self.target, amount=self.increment)
        self.click(self.monitor)
        self.click(self.duplicate)
        self.capture('selected-designer', wrongTargetRejected=rejected)

    def settings_target(self, identifier):
        self.evaluate('sharpforge.openTool("runtime-settings")')
        self.page.locator('#runtime-target').select_option('session:' + identifier)

    def grants(self):
        # Reserved .invalid origins are identifiers only: this scenario sends no
        # network traffic and does not claim HTTP/CORS/transport qualification.
        origins = {identifier: 'https://r015-' + str(index) + '.invalid' for index, identifier in enumerate(self.ids)}
        for identifier in self.ids:
            before = self.snapshot()
            self.settings_target(identifier)
            self.page.locator('#runtime-network').check()
            self.page.locator('#runtime-origins').fill(origins[identifier])
            self.page.locator('#runtime-apply').click()
            self.wait('sharpforge.workbenchServices.settings.get(%s).allowedOrigins[0] === %s'
                      % (json.dumps(identifier), json.dumps(origins[identifier])))
            self.assert_others(before, identifier)
        self.settings_target(self.target)
        self.select(self.monitor)
        require(self.page.locator('#runtime-target').input_value() == 'session:' + self.target,
                'Changing debugger process retargeted the grant editor')
        self.capture('independent-grant-targets', origins=origins,
                     scope='Memory-only settings and launch grants; no HTTP request enforcement claim')

    def restart(self):
        before = self.snapshot()
        self.select(self.target)
        self.page.locator('#stop').click()
        self.wait('sharpforge.workbenchServices.sessions.require(%s).state === "stopped"' % json.dumps(self.target))
        self.assert_others(before, self.target)
        self.click(self.monitor)
        self.click(self.duplicate)
        before_restart = self.snapshot()
        self.select(self.target)
        self.page.locator('#restart').click()
        self.wait('''() => {const s=sharpforge.workbenchServices.sessions.require(%s);
          return s.live && s.debug?.uiActive && !s.launchBusy && s.programOutput === 'dashboard-started\\n';}'''
                  % json.dumps(self.target), timeout=60000)
        current = next(row for row in self.snapshot() if row['id'] == self.target)
        old = next(row for row in before if row['id'] == self.target)
        require(current['identity'] != old['identity'] and not current['sameWorker'], 'Restart reused an old worker identity')
        require(current['activeGrants']['network']['allowedOrigins'] == current['settings']['allowedOrigins'],
                'Restart did not apply the selected application grants')
        self.assert_others(before_restart, self.target)
        self.evaluate('id => r015Sessions.workers.set(id, sharpforge.workbenchServices.sessions.require(id).worker.worker)', self.target)
        self.counts[self.target], self.lines[self.target] = 0, ['dashboard-started']
        self.click(self.target)
        stale_design = self.evaluate('''async () => {
          try { await sharpforge.designer.apply(); return null; }
          catch (error) { return error.message; }
        }''')
        require(stale_design and 'session' in stale_design.lower(), 'Designer attachment survived a worker generation change')
        self.capture('targeted-stop-restart', previousIdentity=old['identity'], identity=current['identity'],
                     staleDesignerRejected=stale_design)

    def pending_callbacks(self):
        before = self.snapshot()
        result = self.evaluate('''async id => {
          const s=sharpforge.workbenchServices.sessions.require(id), oldIdentity=s.identity;
          // Both real requests are posted before restart in this JS turn; no reply
          // callback can run before the worker generation is replaced.
          const generation = s.worker.generation, requestIds = [], pending = [];
          for (const method of ['uiScene', 'designSnapshot']) {
            const promise = s.request(method);
            requestIds.push(s.worker.next);
            pending.push(promise.then(() => ({resolved:true}), error => ({name:error.name,code:error.code,message:error.message})));
          }
          const posted = requestIds.every(id => s.worker.pending.get(id)?.generation === generation);
          await s.restart();
          const callbacks = await Promise.all(pending);
          const stale = await s.request('uiScene',{identity:oldIdentity}).then(() => null,
            error => ({code:error.code,message:error.message}));
          return {posted, requestIds, generation, callbacks, stale, oldIdentity, identity:s.identity,
            oldRequestsRemoved: requestIds.every(id => !s.worker.pending.has(id))};
        }''', self.target)
        require(result['posted'] and result['oldRequestsRemoved'] and all(not row.get('resolved') and row.get('name') == 'AbortError'
                                             and row.get('code') == 'ABORTED'
                                             for row in result['callbacks']), 'Old real worker callbacks survived restart')
        require(result['stale'] and result['stale']['code'] == 'SESSION_STALE' and
                result['oldIdentity'] != result['identity'], 'Old generation request was accepted')
        self.wait('''() => {const s=sharpforge.workbenchServices.sessions.require(%s);
          return s.debug?.uiActive && s.programOutput === 'dashboard-started\\n';}''' % json.dumps(self.target))
        self.assert_others(before, self.target)
        self.evaluate('id => r015Sessions.workers.set(id, sharpforge.workbenchServices.sessions.require(id).worker.worker)', self.target)
        self.counts[self.target], self.lines[self.target] = 0, ['dashboard-started']
        self.click(self.target)
        self.click(self.monitor)
        self.click(self.duplicate)
        self.capture('pending-worker-callbacks', **result,
                     scope='Real posted worker RPC callbacks cancelled across restart; no fabricated event delivery')

    def revoke_and_stop(self):
        before = self.snapshot()
        self.settings_target(self.target)
        self.select(self.monitor)
        self.page.locator('#runtime-revoke').click()
        self.wait('sharpforge.workbenchServices.sessions.require(%s).state === "stopped"' % json.dumps(self.target))
        target = next(row for row in self.snapshot() if row['id'] == self.target)
        require(target['settings']['enabled'] is False and target['settings']['allowedOrigins'] == [],
                'Revocation did not clear the explicitly selected application grants')
        self.assert_others(before, self.target)
        self.click(self.monitor)
        self.click(self.duplicate)
        self.capture('selected-revocation', selectedSettingsTarget=self.target, activeDebugger=self.monitor)


def sessions(page, root, output):
    suite = SessionAcceptance(page, root, output)
    report = {'target': 'production-studio-real-workers', 'requirement': 'session-isolation',
              'requiredLiveApplications': 3, 'projects': [DASHBOARD, MONITOR], 'duplicateProject': DASHBOARD,
              'checks': suite.checks, 'status': 'running',
              'unexecutedPhases': [],
              'limits': ['This run qualifies only its recorded browser/host.',
                         'Grant routing is exercised without outbound HTTP; transport enforcement is a separate obligation.',
                         'Late callbacks are real pending worker replies across restart, not delayed provider/network callbacks.']}
    phases = [('three-live-applications', suite.prepare), ('selected-debugger', suite.debugger),
              ('selected-hot-reload', suite.hot_reload), ('selected-designer', suite.designer),
              ('independent-grant-targets', suite.grants), ('targeted-stop-restart', suite.restart),
              ('pending-worker-callbacks', suite.pending_callbacks), ('selected-revocation', suite.revoke_and_stop)]
    try:
        for name, run in phases:
            report['activePhase'] = name
            run()
        report.pop('activePhase', None)
        blocked = [check for check in suite.checks if check['status'] == 'blocked']
        report['status'] = 'blocked' if blocked else 'passed'
        if blocked:
            report['blocker'] = 'MULTI-APP'
            report['blockedSequence'] = ('The full Hot Reload/design/stop/restart conjunction is unqualified; '
                                         'independent checks describe only the operations actually exercised.')
        return report
    except BaseException as error:
        report['status'] = 'failed'
        report['failure'] = {'type': type(error).__name__, 'message': str(error)}
        if not any(check['name'] == report.get('activePhase') for check in suite.checks):
            suite.checks.append({'name': report.get('activePhase'), 'status': 'failed', 'error': report['failure']})
        completed = {check['name'] for check in suite.checks}
        report['unexecutedPhases'] = [{'name': name, 'status': 'blocked', 'reason': 'Earlier phase failed'}
                                     for name, _ in phases if name not in completed and name != report.get('activePhase')]
        raise
    finally:
        try:
            suite.evaluate("sharpforge.execute('stop-all')")
            suite.wait('sharpforge.workbenchServices.sessions.list({liveOnly:true}).length === 0')
        except BaseException as error:
            report['cleanupFailure'] = {'type': type(error).__name__, 'message': str(error)}
            if report['status'] in ('passed', 'blocked'):
                report['status'] = 'failed'
                raise
        finally:
            (output / 'sessions-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
