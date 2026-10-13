import { splitCommandLine } from './argument-policy.js';

/** Parse compiler arguments without dropping unrecognised switches or reference aliases. */
export function parseCscArguments(input, { maxArguments = 20000, maxCharacters = 1048576 } = {}) {
  if (!Number.isSafeInteger(maxArguments) || maxArguments < 1 || maxArguments > 100000
    || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 16777216) throw new Error('Invalid compiler argument limits');
  const argumentsList = typeof input === 'string' ? splitCommandLine(input, { maxArguments }) : input;
  if (!Array.isArray(argumentsList) || argumentsList.length > maxArguments) throw new Error('Compiler argument limit exceeded');
  const result = { defines: [], references: [], analyzers: [], additionalFiles: [], analyzerConfigFiles: [], sources: [],
    noWarn: [], warningsAsErrors: [], warningsNotAsErrors: [], unknown: [], responseFiles: [],
    langVersion: null, nullable: null, unsafe: false, checked: false, output: null, target: 'library', allWarningsAsErrors: false };
  const lists = { define: 'defines', d: 'defines', nowarn: 'noWarn' };
  const paths = { analyzer: 'analyzers', additionalfile: 'additionalFiles', analyzerconfig: 'analyzerConfigFiles' };
  let characters = 0;
  for (const argument of argumentsList) {
    if (typeof argument !== 'string' || argument.length > 1048576 || argument.includes('\0')) throw new Error('Invalid compiler argument');
    if ((characters += argument.length) > maxCharacters) throw new Error('Compiler argument character limit exceeded');
    if (argument.startsWith('@')) { result.responseFiles.push(argument.slice(1)); continue; }
    if (argument.startsWith('/') && /\.csx?$/i.test(argument) && !/^\/[^/:]+:/.test(argument)) {
      result.sources.push(argument);
      continue;
    }
    const match = /^[-/]([^:+=-]+)([+-])?(?::(.*))?$/.exec(argument);
    if (!match) { result.sources.push(argument); continue; }
    const name = match[1].toLowerCase(), sign = match[2], value = match[3];
    if (lists[name]) result[lists[name]].push(...(value ?? '').split(/[;,]/).filter(Boolean));
    else if (paths[name]) result[paths[name]].push(...(value ?? '').split(',').filter(Boolean));
    else if (name === 'reference' || name === 'r') {
      const equals = (value ?? '').indexOf('=');
      const aliases = equals < 0 ? ['global'] : value.slice(0, equals).split(',');
      const path = equals < 0 ? value : value.slice(equals + 1);
      if (!path) throw new Error('Compiler reference path is missing');
      result.references.push({ path, aliases });
    } else if (name === 'warnaserror') {
      if (value) result[sign === '-' ? 'warningsNotAsErrors' : 'warningsAsErrors'].push(...value.split(/[;,]/).filter(Boolean));
      else result.allWarningsAsErrors = sign !== '-';
    } else if (['unsafe', 'checked'].includes(name)) result[name] = sign !== '-' && value !== 'false';
    else if (name === 'langversion') result.langVersion = value;
    else if (name === 'nullable') result.nullable = value;
    else if (name === 'out') result.output = value;
    else if (name === 'target' || name === 't') result.target = value;
    else result.unknown.push(argument);
  }
  result.defines = [...new Set(result.defines)];
  return result;
}

export async function expandCscResponseFiles(input, read, { maxDepth = 8, maxArguments = 20000, maxCharacters = 1048576 } = {}) {
  const result = [], visiting = new Set();
  let characters = 0;
  async function expand(argumentsList, depth) {
    if (depth > maxDepth) throw new Error('Compiler response file depth exceeded');
    for (const argument of argumentsList) {
      if (!argument.startsWith('@')) result.push(argument);
      else {
        const path = argument.slice(1);
        if (visiting.has(path)) throw new Error('Compiler response file cycle: ' + path);
        visiting.add(path);
        const text = await read(path);
        if (typeof text !== 'string' || (characters += text.length) > maxCharacters) throw new Error('Compiler response text limit exceeded');
        await expand(splitCommandLine(text.split(/\r?\n/).filter(line => !line.trimStart().startsWith('#')).join('\n')), depth + 1);
        visiting.delete(path);
      }
      if (result.length > maxArguments) throw new Error('Compiler argument limit exceeded');
    }
  }
  await expand(typeof input === 'string' ? splitCommandLine(input) : input, 0);
  return result;
}
