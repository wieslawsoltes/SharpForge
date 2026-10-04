import {sessionDom} from './a18-session-dom.js';

const decode = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'").replaceAll('&amp;', '&');
const voidTags = new Set(['INPUT', 'BR', 'HR', 'IMG']);

/** Explicit native input/markup boundary; production CodeEditor and syntax code remain unmodified. */
export function editorDom() {
  const fixture = sessionDom();
  const create = fixture.document.createElement;
  fixture.document.createElement = tag => {
    const element = create(tag);
    element.scrollTop = 0;
    element.scrollLeft = 0;
    element.clientHeight = 440;
    element.clientWidth = 800;
    element.selectionStart = 0;
    element.selectionEnd = 0;
    element.htmlWrites = 0;
    const setAttribute = element.setAttribute.bind(element);
    element.setAttribute = (name, value) => {
      setAttribute(name, value);
      if (name === 'class') element.className = String(value);
      if (name === 'hidden') element.hidden = true;
      if (name.startsWith('data-')) element.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    };
    element.removeAttribute = name => element.attributes.delete(name);
    const matches = element.matches.bind(element);
    element.matches = selector => matches(selector.replace(/=([^"\]\s]+)\]/g, '="$1"]'));
    element.setRangeText = (value, start, end, mode) => {
      element.value = element.value.slice(0, start) + value + element.value.slice(end);
      if (mode === 'end') element.setSelectionRange(start + value.length, start + value.length);
    };
    Object.defineProperty(element, 'innerHTML', {
      get: () => element.markup ?? '',
      set: markup => {
        element.htmlWrites++;
        element.markup = String(markup);
        element.replaceChildren();
        parseMarkup(fixture.document, element, element.markup);
      }
    });
    return element;
  };
  const element = fixture.document.createElement('main');
  fixture.document.body.append(element);
  return {...fixture, element};
}

/** This parser consumes only CodeEditor's trusted test markup; it executes no HTML or script. */
function parseMarkup(document, root, markup) {
  const stack = [root];
  for (const part of markup.matchAll(/<\/?[\w-]+\b[^>]*>|[^<]+/g)) {
    if (part[0].startsWith('</')) {
      if (stack.length > 1) stack.pop();
    } else if (part[0].startsWith('<')) {
      const name = /^<([\w-]+)/.exec(part[0])[1];
      const element = document.createElement(name);
      const attributes = part[0].slice(name.length + 1, -1);
      for (const match of attributes.matchAll(/([:\w-]+)(?:="([^"]*)"|'([^']*)'|=([^\s>]+))?/g)) {
        element.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ''));
      }
      stack.at(-1).append(element);
      if (!voidTags.has(element.tagName)) stack.push(element);
    } else {
      const text = document.createElement('#text');
      text.textContent = decode(part[0]);
      stack.at(-1).append(text);
    }
  }
}
