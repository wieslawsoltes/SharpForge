import { splitArguments, unquote, scanMember } from './expression-scanner.js';
import { fail, formatValue, getCaseInsensitive } from './errors.js';
import { getItemMetadata } from './item-metadata.js';
import { invokeStringMember, isStringMember } from './functions-string.js';

const distinct = (values, context, sensitive) => {
  const seen = new Set();
  return values.filter(item => {
    const value = sensitive ? item.identity : item.identity.toLowerCase();
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

const functions = {
  count: values => String(values.length),
  distinct: (values, args, context) => distinct(values, context, false),
  distinctwithcase: (values, args, context) => distinct(values, context, true),
  reverse: values => [...values].reverse(),
  anyhavemetadatavalue: (values, args, context) => formatValue(values.some(item =>
    getItemMetadata(item, args[0], context).toLowerCase() === String(args[1]).toLowerCase())),
  withmetadatavalue: (values, args, context) => values.filter(item =>
    getItemMetadata(item, args[0], context).toLowerCase() === String(args[1]).toLowerCase()),
  withoutmetadatavalue: (values, args, context) => values.filter(item =>
    getItemMetadata(item, args[0], context).toLowerCase() !== String(args[1]).toLowerCase()),
  hasmetadata: (values, args, context) => values.filter(item => getItemMetadata(item, args[0], context) !== ''),
  metadata: (values, args, context) => values.map(item => ({ ...item, identity: getItemMetadata(item, args[0], context) })).filter(item => item.identity),
  dirname: (values, args, context) => values.map(item => ({ ...item, identity: getItemMetadata(item, 'Directory', context) })),
  directoryname: (values, args, context) => values.map(item => ({ ...item, identity: getItemMetadata(item, 'Directory', context) })),
  clearmetadata: values => values.map(item => ({ ...item, metadata: {} })),
  exists: (values, args, context) => values.filter(item => context.exists(item.identity)),
};

function transform(values, expression, context) {
  if (typeof values === 'string') fail('Cannot transform the scalar result of an item function.');
  const quoted = ['"', "'", '`'].includes(expression[0]);
  if (quoted) return values.map(item => ({ ...item, identity: context.withItem(item, () => context.expand(unquote(expression))) }));
  const call = scanMember(expression);
  if (call.end !== expression.length) fail(`Invalid item transform '${expression}'.`);
  const args = (call.arguments ?? []).map(value => context.expand(unquote(value)));
  const handler = functions[call.name.toLowerCase()];
  if (handler) return handler(values, args, context);
  if (!isStringMember(call.name)) fail(`Unknown item function '${call.name}'.`, 'MSB4185');
  return values.map(item => ({ ...item, identity: formatValue(invokeStringMember(item.identity, call.name, args)) }));
}

/** Evaluate item expressions, retaining source metadata across transforms and item copies. */
export function evaluateItemExpression(body, context, { preserveItems = false } = {}) {
  if (!context.items) fail('Item references require a project item context.', 'MSB4191');
  const outer = splitArguments(body);
  if (outer.length > 2) fail('Item expressions accept one optional separator.');
  const pipeline = splitArguments(outer[0], '->');
  const type = pipeline.shift().trim();
  if (!/^[A-Za-z_][\w.-]*$/.test(type)) fail(`Invalid item type '${type}'.`);
  let values = [...(getCaseInsensitive(context.items, type) ?? [])];
  for (const expression of pipeline) values = transform(values, expression, context);
  if (typeof values === 'string') return values;
  if (preserveItems && outer.length === 1) return values;
  const separator = outer.length === 2 ? context.expand(unquote(outer[1])) : ';';
  return values.map(item => item.identity).join(separator);
}
