import {beginPublicHost} from './public-host.js';

/** Native composition commands are supplied by Chromium CDP; this fixture never synthesizes input/composition events. */
export async function createNativeImeFixture(definition, options) {
  const session = beginPublicHost(definition, options);
  try {
    const {app, host} = session;
    const X = app.Microsoft.UI.Xaml;
    const text = new X.Controls.TextBox();
    text.Name = 'NativeImeEditor';
    text.Width = definition.width;
    text.Height = definition.height;
    const window = new X.Window();
    window.Content = text;
    window.Activate();
    await session.settle();
    const node = [...host.nodes.values()].find(value => value.properties.Name === text.Name);
    const editor = host.elements.get(node.id).querySelector('[data-part="text-editor"]');
    if (editor?.tagName !== 'INPUT') throw new Error('Native IME fixture did not create an actual editable input');
    const events = [];
    const capture = event => events.push({type: event.type, trusted: event.isTrusted, data: event.data ?? null,
      inputType: event.inputType ?? null, composing: !!event.isComposing});
    const names = ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'];
    for (const name of names) editor.addEventListener(name, capture);
    let completed = false;
    const verify = () => {
      if (!completed) return {passed: false, status: 'incomplete-native-ime', reason: 'Native browser composition has not run'};
      if (editor.value !== '漢字' || text.Text !== '漢字' || text.SelectionStart !== 2 || text.SelectionLength !== 0) {
        throw new Error('Native composition did not commit exact text and UTF-16 selection to the managed editor');
      }
      for (const name of ['compositionstart', 'compositionupdate', 'compositionend', 'input']) {
        if (!events.some(event => event.type === name && event.trusted)) throw new Error('Missing trusted browser IME event: ' + name);
      }
      if (events.some(event => !event.trusted)) throw new Error('Synthetic input cannot qualify the native IME fixture');
      return {passed: true, method: 'Chromium CDP Input.imeSetComposition + Input.insertText', events: [...events],
        text: text.Text, selectionStart: text.SelectionStart, selectionLength: text.SelectionLength,
        scope: 'Browser native composition path; operating-system IME candidate UI and other browsers remain separate'};
    };
    return {...session, verify,
      async interaction(phase) {
        if (phase === 'focus') {
          editor.focus();
          return {focused: options.document.activeElement === editor, inputTag: editor.tagName};
        }
        if (phase !== 'finish') throw new Error('Unknown native IME fixture phase');
        await session.settle();
        completed = true;
        const result = verify();
        editor.blur();
        await session.settle();
        return result;
      },
      dispose() {
        for (const name of names) editor.removeEventListener(name, capture);
        session.dispose();
      }};
  } catch (error) {
    session.dispose();
    throw error;
  }
}
