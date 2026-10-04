import {SourceText} from '@sharpforge/text';
import {AsyncRequestGuard, editorRevision} from '../services/async-guard.js';
import {EditorLanguageServices, createRequestServices} from '../services/providers.js';
import {editorWorkspace, workspaceVersions} from '../services/workspace-edit.js';
import {WidgetLifetime, node} from '../widgets/dom.js';

export function createInsightContext(editor, options) {
  const services = options.services instanceof EditorLanguageServices || options.services?.invoke ? options.services :
    options.services ? new EditorLanguageServices(options.services) : createRequestServices((method, parameters) => editor.request(method, parameters));
  const document = editor.element.ownerDocument;
  const lifetime = new WidgetLifetime();
  const guard = new AsyncRequestGuard(() => editorRevision(editor));
  const workspace = options.workspace ?? editorWorkspace(editor);
  const statusElement = node(document, 'div', {className: 'sf-insight-status', role: 'status', 'aria-live': 'polite'});
  editor.element.append(statusElement);
  const context = {editor, options, services, document, lifetime, guard, workspace, statusElement,
    source(value) { return new SourceText(value.text, value.uri, value.version); },
    status(message) { statusElement.textContent = message; options.onStatus?.(message); },
    async safe(callback) {
      try { return await callback(); }
      catch (error) {
        if (error?.name !== 'AbortError') {
          context.status(`${error.code ? `${error.code}: ` : ''}${error.message}`);
          options.onError?.(error);
        }
        return undefined;
      }
    },
    async request(method, parameters = {}, requestOptions = {}) {
      if (!services.supports(method)) return undefined;
      const maximum = options.maxSemanticCharacters ?? 2_000_000;
      if (method !== 'readDocument' && !options.languageServicesInLargeFiles && (editor.model?.length ?? editor.value.length) > maximum) {
        return undefined;
      }
      const versions = workspaceVersions(workspace);
      const validation = method === 'readDocument' ? {...requestOptions, validateResponseVersion: false} : requestOptions;
      const result = await guard.run(requestOptions.key ?? method, value => services.invoke(method, value), parameters, validation);
      return result ? {...result, versions} : undefined;
    },
    async navigate(location, navigationOptions = {}) {
      const uri = location.uri ?? location.targetUri;
      let destination = { ...location, uri };
      if (uri === editor.uri) {
        const source = editor.sourceSnapshot();
        const range = location.range ?? location.targetSelectionRange;
        const start = location.start ?? (range ? source.offsetAt(range.start) : 0);
        const end = location.end ?? (range ? source.offsetAt(range.end) : start);
        destination = { ...destination, start, end };
      }
      if (options.openDocument) {
        const focused = document.activeElement;
        try { return await options.openDocument(destination, navigationOptions); }
        finally { if (navigationOptions.preserveFocus) focused?.focus?.({preventScroll: true}); }
      }
      if (uri === editor.uri) return editor.goto(destination.start, destination.end);
      return editor.request('openDocument', destination);
    },
    command(command) {
      if (services.supports('executeCommand')) return services.invoke('executeCommand', {
        command: command.command ?? command.id ?? command, arguments: command.arguments ?? [],
        uri: editor.uri, version: editor.model?.version ?? editor.sourceSnapshot().version,
        signal: new AbortController().signal
      });
      return editor.request(command.command ?? command.id ?? command, command.arguments?.[0] ?? {uri: editor.uri, offset: editor.offset});
    }
  };
  return context;
}
