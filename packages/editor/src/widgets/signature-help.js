import {lex} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {EditorPopup, node, button, appendDocumentation} from './dom.js';

/** Tracks delimiter nesting for presentation only; the language provider still resolves signatures. */
export function signatureCallContext(text, offset, tokens = lex(new SourceText(text)).tokens) {
  const stack = [];
  for (const token of tokens) {
    if (token.start >= offset) break;
    const kind = token.kind;
    if (kind === '(' || kind === '[' || kind === '{') stack.push({kind, start: token.start, argument: 0});
    else if (kind === ')' || kind === ']' || kind === '}') stack.pop();
    else if (kind === ',' && stack.at(-1)?.kind === '(') stack.at(-1).argument++;
  }
  return [...stack].reverse().find(frame => frame.kind === '(') ?? null;
}

export function parameterLabelRange(signature, parameter, index) {
  if (Array.isArray(parameter?.label)) return parameter.label;
  if (!parameter?.label) return null;
  let start = signature.label.indexOf('(') + 1;
  for (let cursor = 0; cursor < index; cursor++) {
    const label = signature.parameters[cursor]?.label;
    if (typeof label !== 'string') continue;
    const found = signature.label.indexOf(label, start);
    if (found >= 0) start = found + label.length;
  }
  const found = signature.label.indexOf(parameter.label, start);
  return found < 0 ? null : [found, found + parameter.label.length];
}

export class SignatureHelpWidget {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'signature-help', 'group');
    this.signatures = [];
    this.index = 0;
  }

  async open(triggerCharacter) {
    const editor = this.context.editor;
    if (!this.context.options.languageServicesInLargeFiles &&
        (editor.model?.length ?? editor.value.length) > (this.context.options.maxSemanticCharacters ?? 2_000_000)) return;
    const offset = editor.offset;
    const call = signatureCallContext(editor.value, offset, editor.lexed?.tokens);
    if (!call) return this.close();
    const result = await this.context.request('signatureHelp', {offset: editor.offset, triggerCharacter,
      callStart: call.start, activeParameter: call.argument});
    if (!result || editor.offset !== offset) return;
    const help = result.value;
    if (!help?.signatures?.length) return this.close();
    this.signatures = help.signatures;
    this.index = Math.max(0, Math.min(help.activeSignature ?? this.index, this.signatures.length - 1));
    this.parameter = call.argument;
    this.callStart = call.start;
    this.render();
    this.popup.show();
  }

  render() {
    const document = this.context.document;
    const signature = this.signatures[this.index];
    if (!signature) return;
    const controls = node(document, 'div', {className: 'sf-signature-controls'});
    controls.append(button(document, '↑', () => this.cycle(-1), {'aria-label': 'Previous overload'}),
      node(document, 'span', {}, `${this.index + 1} of ${this.signatures.length}`),
      button(document, '↓', () => this.cycle(1), {'aria-label': 'Next overload'}));
    const label = node(document, 'code');
    const active = signature.parameters?.[signature.activeParameter ?? this.parameter];
    const range = parameterLabelRange(signature, active, signature.activeParameter ?? this.parameter);
    if (range) label.append(document.createTextNode(signature.label.slice(0, range[0])),
      node(document, 'strong', {className: 'sf-active-parameter'}, signature.label.slice(range[0], range[1])),
      document.createTextNode(signature.label.slice(range[1])));
    else label.textContent = signature.label;
    this.popup.element.replaceChildren(controls, label);
    appendDocumentation(this.popup.element, signature.documentation);
    appendDocumentation(this.popup.element, active?.documentation);
  }

  cycle(direction) {
    this.index = (this.index + direction + this.signatures.length) % this.signatures.length;
    this.render();
  }

  keydown(event) {
    if (!this.popup.visible) return false;
    if (event.key === 'Escape') { this.close(); return true; }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this.cycle(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    return false;
  }

  close() { this.context.guard.cancel('signatureHelp'); this.popup.close(); }
  dispose() { this.close(); this.popup.dispose(); }
}
