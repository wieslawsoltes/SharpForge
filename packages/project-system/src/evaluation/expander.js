import { scanReference, referenceStart, scanMember, unquote } from './expression-scanner.js';
import { fail, formatValue, getCaseInsensitive, unescape } from './errors.js';
import { invokeTypedMember, invokeStaticFunction } from './functions-static.js';
import { invokeMSBuildFunction } from './functions-msbuild.js';
import { evaluateItemExpression } from './item-expressions.js';
import { expandMetadata } from './item-metadata.js';

function argument(text, context) {
  const quoted = ['"', "'", '`'].includes(text[0]);
  const value = unquote(text.trim());
  if (!quoted && referenceStart(value, 0)) {
    const reference = scanReference(value, 0);
    if (reference.end === value.length) return evaluateReference(reference, context);
  }
  const expanded = expandExpression(value, context);
  if (!quoted && /^[-+]?\d+(?:\.\d+)?$/.test(expanded)) return Number(expanded);
  if (!quoted && /^(true|false)$/i.test(expanded)) return expanded.toLowerCase() === 'true';
  return expanded;
}

function property(body, context) {
  const text = body.trim();
  let offset = 0;
  let receiver;
  if (text[0] === '[') {
    const match = /^\[([^\]]+)\]::/.exec(text);
    if (!match) fail(`Malformed static property function '${text}'.`);
    const member = scanMember(text, match[0].length);
    const args = (member.arguments ?? []).map(value => argument(value, context));
    receiver = match[1].toLowerCase() === 'msbuild' ? invokeMSBuildFunction(member.name, args, context)
      : invokeStaticFunction(match[1], member.name, args, context);
    offset = member.end;
  } else {
    const name = /^[A-Za-z_][\w-]*/.exec(text)?.[0];
    if (!name) fail(`Invalid property reference '$(${text})'.`);
    receiver = getCaseInsensitive(context.properties, name) ?? '';
    offset = name.length;
  }
  while (offset < text.length) {
    if (!['.', '['].includes(text[offset])) fail(`Invalid property function suffix '${text.slice(offset)}'.`);
    const member = scanMember(text, offset);
    receiver = invokeTypedMember(receiver, member.name, (member.arguments ?? []).map(value => argument(value, context)));
    offset = member.end;
  }
  return receiver;
}

export function evaluateReference(reference, context) {
  const depth = context.expressionDepth ?? 0;
  if (depth >= (context.limits?.expressionDepth ?? 64)) fail('Expression recursion limit exceeded.');
  context.expressionDepth = depth + 1;
  try {
    if (reference.kind === '$') return property(reference.body, context);
    if (reference.kind === '@') return evaluateItemExpression(reference.body, context);
    return expandMetadata(reference.body, context);
  } finally { context.expressionDepth = depth; }
}

/** Expand scanned references without reparsing injected values; %XX decoding occurs last. */
export function expandExpression(value, context = {}, { decode = true, metadata = true } = {}) {
  const text = String(value ?? '');
  const maximum = context.limits?.expressionLength ?? 65536;
  if (text.length > maximum) fail('Expression text limit exceeded.');
  if (!context.expand) context.expand = (value, options) => expandExpression(value, context, options);
  if (!context.withItem) context.withItem = (item, action) => {
    const previous = context.currentItem;
    context.currentItem = item;
    try { return action(); }
    finally { context.currentItem = previous; }
  };
  const output = [];
  let length = 0;
  let start = 0;
  for (let offset = 0; offset < text.length; offset++) {
    if (!referenceStart(text, offset)) continue;
    const reference = scanReference(text, offset);
    const prefix = text.slice(start, offset);
    const replacement = !metadata && reference.kind === '%' ? text.slice(reference.start, reference.end)
      : formatValue(evaluateReference(reference, context));
    length += prefix.length + replacement.length;
    if (length > maximum) fail('Expanded expression length limit exceeded.');
    output.push(prefix, replacement);
    start = reference.end;
    offset = start - 1;
  }
  output.push(text.slice(start));
  const result = output.join('');
  if (result.length > maximum) fail('Expanded expression length limit exceeded.');
  return decode ? unescape(result) : result;
}
