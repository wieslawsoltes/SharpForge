import { TemplateError } from '../common.js';

/** Restrict configured regex to bounded, non-recursive constructs before using the host regex engine. */
export function templateRegex(pattern, flags = 'g') {
  if (typeof pattern !== 'string' || pattern.length > 256 || /\\[1-9]|\(\?[=!<]|\)[+*?{]/.test(pattern)) {
    throw new TemplateError('SFTPL011', 'Unsupported or unbounded template regular expression');
  }
  // Arbitrary repeated expressions backtrack exponentially in JS. A single repeated atom is linear;
  // other accepted patterns have only bounded repetition and at most four optional atoms.
  const atoms = pattern.replace(/\\.|\[(?:\\.|[^\]\\])*\]/g, 'a');
  const singleRepeatedAtom = /^\^?(?:\\.|\[(?:\\.|[^\]\\])*\]|[^()[\]{}*+?^$|\\])[+*]\$?$/.test(pattern);
  if ((/[+*]/.test(atoms) && !singleRepeatedAtom) || (atoms.match(/\?/g) ?? []).length > 4 ||
      (atoms.match(/\{/g) ?? []).length > 1 || /\{(\d+)(?:,(\d*))?\}/g.test(atoms) &&
      [...atoms.matchAll(/\{(\d+)(?:,(\d*))?\}/g)].some(match => Number(match[1]) > 32 || match[2] === '' || Number(match[2] ?? 0) > 32)) {
    throw new TemplateError('SFTPL011', 'Unsupported or unbounded template regular expression');
  }
  if (!/^[gimuy]*$/.test(flags)) throw new TemplateError('SFTPL011', 'Unsupported template regex flags');
  try { return new RegExp(pattern, flags); }
  catch (cause) { throw new TemplateError('SFTPL011', 'Invalid template regex', { cause }); }
}

const builtins = {
  identity: value => value,
  lowerCase: value => value.toLowerCase(),
  lowerCaseInvariant: value => value.toLowerCase(),
  upperCase: value => value.toUpperCase(),
  upperCaseInvariant: value => value.toUpperCase(),
  firstLowerCase: value => value ? value[0].toLowerCase() + value.slice(1) : value,
  firstUpperCase: value => value ? value[0].toUpperCase() + value.slice(1) : value,
  safe_name: value => value.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_'),
  safe_namespace: value => value.split('.').map(part => part.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_')).join('.'),
  kebabCase: value => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase(),
  snakeCase: value => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()
};

export function applyValueForm(value, name, forms = {}, stack = []) {
  value = String(value ?? '');
  if (value.length > 65536 || stack.length > 32 || stack.includes(name)) throw new TemplateError('SFTPL011', 'Template value form cycle or limit');
  if (builtins[name]) return builtins[name](value);
  const form = forms[name];
  if (!form) throw new TemplateError('SFTPL011', 'Unknown template value form: ' + name);
  const identifier = form.identifier ?? name;
  if (identifier === 'chain') return (form.steps ?? []).reduce((current, step) => applyValueForm(current, step, forms, [...stack, name]), value);
  if (identifier === 'replace') return value.replace(templateRegex(form.pattern), String(form.replacement ?? ''));
  if (builtins[identifier]) return builtins[identifier](value);
  throw new TemplateError('SFTPL011', 'Unsupported template value form: ' + identifier);
}
