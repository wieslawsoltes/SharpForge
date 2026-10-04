import {escapeHtml as escape} from '@sharpforge/editor';
import {reportAction} from './settings.js';

const selected = condition => condition ? ' selected' : '';
const option = (value, label, active) => `<option value="${escape(value)}"${selected(value === active)}>${escape(label)}</option>`;

function contextDiagnostics(host) {
  const diagnostics = [...host.contexts.diagnostics, ...host.profiles.diagnostics].slice(0, 100);
  return diagnostics.map(diagnostic => `<p class="notice" data-native-context-diagnostic>
    <b>${escape(diagnostic.code ?? diagnostic.severity)}</b> ${escape(diagnostic.message)}
    ${diagnostic.targetFramework ? ' [' + escape(diagnostic.targetFramework) + ']' : ''}</p>`).join('');
}

export function nativeContextMarkup(host) {
  const contexts = host.contexts;
  const profiles = host.profiles;
  const active = contexts.active;
  const launch = profiles.launch.profiles.find(profile => profile.name === profiles.launchProfile);
  const publish = profiles.publish.find(profile => profile.name === profiles.publishProfile);
  const label = context => [context.configuration, context.platform, context.targetFramework || 'default framework',
    context.runtimeIdentifier || 'portable runtime'].join(' · ');
  return `<section class="native-project-context" aria-label="Native project context">
    <h3>Project language context</h3>
    <label class="tool-field">Project for language services, run and tests
      <select data-native-context-project>${(host.workspace?.projects ?? []).map(path => option(path, path, contexts.project)).join('')}</select>
    </label>
    <div class="tool-actions"><button class="button" data-native-context-load>Load project contexts</button>
      <button class="button" data-native-profiles-refresh>Read launch and publish profiles</button>
      <button class="button" data-native-tests-open>Open Test Explorer</button></div>
    <label class="tool-field">Active evaluated context
      <select data-native-context-select ${contexts.contexts.length ? '' : 'disabled'}>
        ${contexts.contexts.length ? contexts.contexts.map(context => option(context.id, label(context), active?.id)).join('') :
      '<option value="">Load contexts to choose a framework and runtime</option>'}
      </select></label>
    <p data-native-context-status role="status">${active ? escape(label(active)) + ' · ' +
      contexts.compilation.files.length + ' sources · ' + contexts.compilation.references.length + ' metadata references' :
    'No native language context loaded. Loading evaluates the project under the workspace trust setting.'}</p>
    <p>Generated sources are read-only. Analyzers and unavailable external sources remain visible in context diagnostics.</p>
    <h3>Launch profiles</h3><label class="tool-field">Launch profile
      <select data-native-launch-profile>${option('', 'No launch profile', profiles.launchProfile)}
      ${profiles.launch.profiles.map(profile => option(profile.name, profile.name + ' · ' + profile.commandName,
    profiles.launchProfile)).join('')}</select></label>
    <p data-native-launch-summary>${launch ? escape(launch.commandName + ' · ' + launch.args.length + ' argument(s) · ' +
    Object.keys(launch.environmentVariables).length + ' environment variable(s)') : 'The project runs with no launch profile.'}</p>
    <label><input type="checkbox" data-native-run-no-build ${profiles.noBuild ? 'checked' : ''}> Use existing build output</label>
    <div class="tool-actions"><button class="button" data-native-project-run>Run project</button></div>
    <h3>Publish profiles</h3><label class="tool-field">Publish profile
      <select data-native-publish-profile>${option('', 'Select a publish profile', profiles.publishProfile)}
      ${profiles.publish.map(profile => option(profile.name, profile.name, profiles.publishProfile)).join('')}</select></label>
    <p>Listing and selecting profiles reads XML without executing build targets. Publish executes the selected profile.</p>
    <div data-native-publish-properties>${publish ? '<dl>' + Object.entries(publish.properties).map(([name, property]) =>
    `<dt>${escape(name)}</dt><dd>${escape(property.value)}${property.evaluated ? '' : ' (requires native evaluation)'}</dd>`).join('') +
    '</dl>' : ''}</div>
    <div class="tool-actions"><button class="button" data-native-profile-publish ${publish ? '' : 'disabled'}>Publish selected profile</button></div>
    <div class="native-context-diagnostics">${contextDiagnostics(host)}</div>
  </section>`;
}

export function bindNativeContextView(host, element) {
  const act = action => reportAction(host, action);
  element.querySelector('[data-native-context-project]').onchange = event => act(() => host.contexts.setProject(event.target.value));
  element.querySelector('[data-native-context-load]').onclick = () => act(() => host.contexts.load());
  element.querySelector('[data-native-context-select]').onchange = event => act(() => host.contexts.select(event.target.value));
  element.querySelector('[data-native-profiles-refresh]').onclick = () => act(() => host.profiles.refresh());
  element.querySelector('[data-native-launch-profile]').onchange = event => act(() => host.profiles.selectLaunch(event.target.value));
  element.querySelector('[data-native-publish-profile]').onchange = event => act(() => host.profiles.selectPublish(event.target.value));
  element.querySelector('[data-native-run-no-build]').onchange = event => { host.profiles.noBuild = event.target.checked; };
  element.querySelector('[data-native-project-run]').onclick = () => act(() => host.runProject());
  element.querySelector('[data-native-profile-publish]').onclick = () => act(() => host.publishProfile());
  element.querySelector('[data-native-tests-open]').onclick = () => host.onSelectPanel?.('tests');
}

export function updateNativeContextControls(host, element) {
  for (const control of element.querySelectorAll('.native-project-context button, .native-project-context select, [data-native-run-no-build]')) {
    control.disabled = host.busy || !host.workspace;
  }
  element.querySelector('[data-native-context-select]').disabled ||= !host.contexts.contexts.length;
  element.querySelector('[data-native-profile-publish]').disabled ||= !host.profiles.publishProfile;
  for (const selector of ['[data-native-context-load]', '[data-native-context-select]', '[data-native-project-run]',
    '[data-native-profile-publish]']) element.querySelector(selector).disabled ||= !host.capabilities?.available;
}
