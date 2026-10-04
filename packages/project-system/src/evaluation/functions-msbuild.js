import { escape, unescape, fail, number } from './errors.js';
import { directoryName } from '../paths.js';
import { parseTargetFramework, isTargetFrameworkCompatible, compareFrameworkVersions } from '../tfm.js';

function findAbove(file, start, context) {
  if (!file || /[/\\]/.test(file)) fail('GetPathOfFileAbove requires a file name without directory separators.');
  let directory = context.resolvePath(start || '.', directoryName(context.currentFile));
  for (;;) {
    const path = directory ? directory + '/' + file : file;
    if (context.pathIndex.paths.has(context.pathIndex.key(path))) return '/' + path;
    if (!directory) return '';
    directory = directoryName(directory);
  }
}

function normalize(args, context, directory = false) {
  let result = '';
  for (const value of args) {
    const part = String(value).replaceAll('\\', '/');
    result = part.startsWith('/') ? part : result ? result.replace(/\/$/, '') + '/' + part : part;
  }
  const path = '/' + context.resolvePath(result || '.');
  return directory && !path.endsWith('/') ? path + '/' : path;
}

function relative(args, context) {
  const first = context.resolvePath(String(args[0])).split('/').filter(Boolean);
  const second = context.resolvePath(String(args[1])).split('/').filter(Boolean);
  let common = 0;
  while (common < first.length && first[common] === second[common]) common++;
  return [...first.slice(common).map(() => '..'), ...second.slice(common)].join('/') || '.';
}

function compareVersions(first, second) {
  const parse = value => {
    const match = /^v?(\d+(?:\.\d+){0,3})(?:[-+].*)?$/i.exec(String(value));
    if (!match) fail(`'${value}' is not an MSBuild version.`);
    return match[1];
  };
  return compareFrameworkVersions(parse(first), parse(second));
}

function frameworkPart(args, part) {
  const framework = parseTargetFramework(args[0]);
  if (!framework.supported) fail(`Unknown target framework '${args[0]}'.`);
  if (!part.endsWith('Version') && part !== 'version') return framework[part];
  const count = args[1] === undefined ? 2 : number(args[1], true);
  if (count < 2 || count > 4) fail('Framework version part count must be between 2 and 4.');
  const values = (framework[part] || '0.0').split('.');
  while (values.length < count) values.push('0');
  return values.slice(0, count).join('.');
}

function stableHash(args) {
  const value = String(args[0]);
  const mode = String(args[1] ?? 'Legacy');
  if (mode === 'Fnv1a32bitFast' || mode === 'Fnv1a32bit') {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      hash = Math.imul(hash ^ (mode === 'Fnv1a32bitFast' ? code : code & 255), 16777619);
      if (mode === 'Fnv1a32bit') hash = Math.imul(hash ^ code >>> 8, 16777619);
    }
    return hash | 0;
  }
  if (mode !== 'Legacy') fail(`StableStringHash algorithm '${mode}' requires the native engine.`);
  let first = (5381 << 16) + 5381;
  let second = first;
  const word = offset => (value.charCodeAt(offset) || 0) | ((value.charCodeAt(offset + 1) || 0) << 16);
  for (let offset = 0; offset < value.length; offset += 4) {
    first = ((first << 5) + first + (first >> 27)) ^ word(offset);
    if (offset + 2 < value.length) second = ((second << 5) + second + (second >> 27)) ^ word(offset + 2);
  }
  return (first + Math.imul(second, 1566083941)) | 0;
}

const functions = {
  add: args => number(args[0]) + number(args[1]),
  subtract: args => number(args[0]) - number(args[1]),
  multiply: args => number(args[0]) * number(args[1]),
  divide: args => number(args[1]) === 0 ? fail('Division by zero.') : number(args[0]) / number(args[1]),
  modulo: args => number(args[1]) === 0 ? fail('Division by zero.') : number(args[0]) % number(args[1]),
  bitwiseor: args => number(args[0], true) | number(args[1], true),
  bitwiseand: args => number(args[0], true) & number(args[1], true),
  bitwisexor: args => number(args[0], true) ^ number(args[1], true),
  bitwisenot: args => ~number(args[0], true),
  leftshift: args => number(args[0], true) << number(args[1], true),
  rightshift: args => number(args[0], true) >> number(args[1], true),
  rightshiftunsigned: args => number(args[0], true) >>> number(args[1], true),
  escape: args => escape(args[0]),
  unescape: args => unescape(args[0]),
  valueordefault: args => args[0] === '' || args[0] === null || args[0] === undefined ? args[1] : args[0],
  ensuretrailingslash: args => !args[0] || /[/\\]$/.test(args[0]) ? args[0] : args[0] + '/',
  normalizepath: (args, context) => normalize(args, context),
  normalizedirectory: (args, context) => normalize(args, context, true),
  makerelative: relative,
  getpathoffileabove: (args, context) => findAbove(String(args[0]), args[1], context),
  getdirectorynameoffileabove: (args, context) => {
    const path = findAbove(String(args[1]), args[0], context);
    return path ? directoryName(path) || '/' : '';
  },
  isosplatform: (args, context) => String(args[0]).toLowerCase() === String(context.osPlatform ?? 'linux').toLowerCase(),
  versionequals: args => compareVersions(args[0], args[1]) === 0,
  versionnotequals: args => compareVersions(args[0], args[1]) !== 0,
  versiongreaterthan: args => compareVersions(args[0], args[1]) > 0,
  versiongreaterthanorequals: args => compareVersions(args[0], args[1]) >= 0,
  versionlessthan: args => compareVersions(args[0], args[1]) < 0,
  versionlessthanorequals: args => compareVersions(args[0], args[1]) <= 0,
  istargetframeworkcompatible: args => isTargetFrameworkCompatible(args[0], args[1]),
  gettargetframeworkidentifier: args => frameworkPart(args, 'identifier'),
  gettargetframeworkversion: args => frameworkPart(args, 'version'),
  gettargetplatformidentifier: args => frameworkPart(args, 'platform'),
  gettargetplatformversion: args => frameworkPart(args, 'platformVersion'),
  stablestringhash: stableHash,
  arefeaturesenabled: (args, context) => compareVersions(args[0], context.featureWave ?? '17.0') <= 0,
};

/** Invoke a deterministic MSBuild intrinsic over explicit context only. */
export function invokeMSBuildFunction(member, args, context) {
  const method = functions[member.toLowerCase()];
  if (!method) fail(`MSBuild intrinsic '${member}' is not implemented.`, 'MSB4185');
  const value = method(args, context);
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`MSBuild intrinsic '${member}' overflowed.`);
  return value;
}
