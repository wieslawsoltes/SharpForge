const outputProperties = new Set([
  'outputpath', 'baseoutputpath', 'intermediateoutputpath', 'baseintermediateoutputpath',
  'publishdir', 'artifacts path', 'artifactspath', 'outdir', 'packageoutputpath', 'errorlog'
]);
const denied = /^(?:[-/])(?:l|logger|dl|distributedlogger|tv|toolsversion|toolspath|noconsolelogger)(?::|$)/i;
const outputSwitch = /^(?:[-/])(?:bl|binarylogger|flp\d*|fileloggerparameters\d*|pp|preprocess|profileevaluation)(?::|$)/i;

function failure(message) {
  return Object.assign(new Error(message), { code: 'SFMSB_ARGUMENT_POLICY', status: 400 });
}

/** Reject paths that cannot be proven workspace-relative without evaluating project code. */
export function validateOutputProperties(properties) {
  for (const [name, raw] of Object.entries(properties)) {
    if (!outputProperties.has(name.toLowerCase())) continue;
    const value = String(raw).replaceAll('\\', '/');
    if (!value || /^(?:\/|[A-Za-z]:)/.test(value) || /\$\(|%[0-9a-f]{2}|[;\0]/i.test(value)) {
      throw failure('Output property must be a literal workspace-relative path: ' + name);
    }
    if (value.split('/').some(part => part === '..')) throw failure('Output property escapes the workspace: ' + name);
  }
}

/** Windows-compatible quote handling, with bounded nesting delegated to response-file expansion. */
export function splitCommandLine(text, { maxArguments = 4096, maxLength = 1024 * 1024 } = {}) {
  if (typeof text !== 'string' || text.length > maxLength || text.includes('\0')) throw failure('Invalid command line');
  const values = [];
  let value = '', quoted = false, present = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      let count = 1;
      while (text[index + 1] === '\\') { count++; index++; }
      if (text[index + 1] === '"') {
        value += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) value += '"'; else quoted = !quoted;
        index++;
      } else value += '\\'.repeat(count);
      present = true;
    } else if (character === '"') { quoted = !quoted; present = true; }
    else if (/\s/.test(character) && !quoted) {
      if (present) { values.push(value); value = ''; present = false; }
    } else { value += character; present = true; }
    if (values.length > maxArguments) throw failure('Command line argument limit exceeded');
  }
  if (quoted) throw failure('Unterminated command line quote');
  if (present) values.push(value);
  if (values.length > maxArguments) throw failure('Command line argument limit exceeded');
  return values;
}

export function validateBuildArguments(argumentsList, { elevated = false } = {}) {
  for (const argument of argumentsList) {
    if (!elevated && (denied.test(argument) || outputSwitch.test(argument))) {
      throw failure('Native logger/toolset/output switches require elevated host trust: ' + argument.split(':')[0]);
    }
    const match = /^[-/](?:p|property):(.+)$/i.exec(argument);
    if (match) {
      const properties = Object.create(null);
      for (const item of match[1].split(';')) {
        const separator = item.indexOf('=');
        if (separator <= 0) throw failure('Invalid property switch');
        properties[item.slice(0, separator)] = item.slice(separator + 1);
      }
      validateOutputProperties(properties);
    }
  }
}

export async function validateResponseFiles(argumentsList, read, { elevated = false, maxDepth = 8 } = {}) {
  let total = 0;
  const visiting = new Set();
  async function visit(argumentsToCheck, depth) {
    if (depth > maxDepth) throw failure('Response file nesting limit exceeded');
    validateBuildArguments(argumentsToCheck, { elevated });
    for (const argument of argumentsToCheck) {
      if (!argument.startsWith('@')) continue;
      const path = argument.slice(1).replaceAll('\\', '/');
      if (!path || /^(?:\/|[A-Za-z]:)/.test(path) || path.split('/').some(part => part === '..')) {
        throw failure('Response file must stay inside the workspace');
      }
      if (visiting.has(path)) throw failure('Response file cycle: ' + path);
      visiting.add(path);
      const content = await read(path);
      total += content.length;
      if (total > 1024 * 1024) throw failure('Response file text limit exceeded');
      const text = content.split(/\r?\n/).filter(line => !line.trimStart().startsWith('#')).join('\n');
      await visit(splitCommandLine(text), depth + 1);
      visiting.delete(path);
    }
  }
  await visit(argumentsList, 0);
}
