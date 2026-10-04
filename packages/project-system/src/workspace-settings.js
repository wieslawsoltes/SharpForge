import { portablePath } from '@sharpforge/archive';
import { sanitizeSessionUserSettings } from './session-user-settings.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeString = (value, maximum = 4096) => typeof value === 'string' && value.length <= maximum;

function breakpointFlags(source, target) {
  for (const key of ['enabled', 'oneShot']) if (source[key] !== undefined) {
    if (typeof source[key] !== 'boolean') throw new Error('Invalid breakpoint flag');
    target[key] = source[key];
  }
  for (const key of ['condition', 'hitCondition', 'logMessage']) if (source[key] !== undefined) {
    if (!safeString(source[key])) throw new Error('Invalid breakpoint expression');
    target[key] = source[key];
  }
  if (source.conditionMode !== undefined) {
    if (!['whenTrue', 'whenChanged'].includes(source.conditionMode)) throw new Error('Invalid condition mode');
    target.conditionMode = source.conditionMode;
  }
  return target;
}

function sourceBreakpoints(value, available) {
  if (value !== undefined && !object(value)) throw new Error('Invalid breakpoints');
  const output = Object.create(null);
  let count = 0;
  for (const [path, points] of Object.entries(value ?? {})) {
    portablePath(path);
    if (!Array.isArray(points) || (count += points.length) > 10_000) throw new Error('Breakpoint limit exceeded');
    if (!available.has(path)) continue;
    output[path] = points.map(point => {
      if (!object(point) || !Number.isInteger(point.line) || point.line < 1 || point.line > 2_000_000) {
        throw new Error('Invalid source breakpoint');
      }
      const item = { line: point.line };
      if (point.column !== undefined) {
        if (!Number.isInteger(point.column) || point.column < 1 || point.column > 2_000_000) throw new Error('Invalid breakpoint column');
        item.column = point.column;
      }
      return breakpointFlags(point, item);
    });
  }
  return output;
}

function functionBreakpoints(value = []) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Function breakpoint limit exceeded');
  return value.map(breakpoint => {
    if (!object(breakpoint) || !safeString(breakpoint.name) || !breakpoint.name) throw new Error('Invalid function breakpoint');
    return breakpointFlags(breakpoint, { name: breakpoint.name });
  });
}

function extensionSettings(value) {
  if (!object(value) || JSON.stringify(value).length > 4 * 1024 * 1024) throw new Error('Invalid built-in extension settings');
  const output = {};
  for (const key of ['buildInfo', 'analyzers', 'schema', 'schemaProperties']) if (value[key] !== undefined) {
    if (typeof value[key] !== 'boolean') throw new Error('Invalid extension switch');
    output[key] = value[key];
  }
  if (value.version !== undefined) {
    if (!safeString(value.version, 200)) throw new Error('Invalid generated version');
    output.version = value.version;
  }
  const additional = value.additionalFiles ?? [];
  if (!Array.isArray(additional) || additional.length > 100) throw new Error('Extension input limit exceeded');
  output.additionalFiles = additional.map(file => {
    if (!safeString(file.uri, 1024) || !safeString(file.text, 2 * 1024 * 1024)) throw new Error('Invalid generator input');
    return { uri: file.uri, text: file.text };
  });
  if (value.severities) {
    if (!object(value.severities)) throw new Error('Invalid analyzer settings');
    output.severities = {};
    for (const [key, severity] of Object.entries(value.severities)) {
      if (!/^SFAN\d{4}$/.test(key) || !['default', 'none', 'hint', 'info', 'warning', 'error'].includes(severity)) {
        throw new Error('Invalid analyzer severity');
      }
      output.severities[key] = severity;
    }
  }
  return output;
}

/** Restore bounded data settings only. Plugin code, host URLs, trust flags and absolute paths are excluded. */
export function validateWorkspaceSettings(input = {}, paths = []) {
  if (!object(input)) throw new Error('Invalid workspace settings');
  const available = new Set(paths);
  const hasPath = path => {
    portablePath(path);
    if (!available.has(path)) throw new Error('Workspace entry is missing: ' + path);
    return path;
  };
  const output = {};
  if (input.langVersion !== undefined) {
    if (typeof input.langVersion !== 'string' || !/^(?:[1-9]|1[0-4]|preview)$/.test(input.langVersion)) {
      throw new Error('Invalid workspace language version');
    }
    output.langVersion = input.langVersion;
  }
  if (input.name !== undefined) {
    if (!safeString(input.name, 200) || !input.name) throw new Error('Invalid workspace name');
    output.name = input.name;
  }
  if (input.mode !== undefined) {
    if (!['solution', 'project', 'folder'].includes(input.mode)) throw new Error('Invalid workspace mode');
    output.mode = input.mode;
  }
  if (input.entry != null) {
    output.entry = hasPath(input.entry);
    if (!/\.(slnx|sln|csproj)$/i.test(output.entry)) throw new Error('Invalid workspace entry type');
  }
  if (input.startup != null) {
    output.startup = hasPath(input.startup);
    if (!/\.csproj$/i.test(output.startup)) throw new Error('Invalid startup project');
  }
  for (const name of ['configuration', 'platform']) if (input[name] !== undefined) {
    if (!safeString(input[name], 128) || !input[name]) throw new Error('Invalid ' + name);
    output[name] = input[name];
  }
  if (input.active && available.has(input.active)) output.active = hasPath(input.active);
  if (input.tabs !== undefined) {
    if (!Array.isArray(input.tabs) || input.tabs.length > 200) throw new Error('Too many open documents');
    output.tabs = [...new Set(input.tabs.filter(path => available.has(path)).map(hasPath))];
  }
  output.breakpoints = sourceBreakpoints(input.breakpoints, available);
  output.functionBreakpoints = functionBreakpoints(input.functionBreakpoints);
  if (input.extensions != null) output.extensions = extensionSettings(input.extensions);
  return Object.assign(output, sanitizeSessionUserSettings(input, { paths: available }));
}

/** Enforce the reader's byte budget on the exact serialized manifest, including indentation and multibyte names. */
export function workspaceSettingsManifest(settings) {
  const text = JSON.stringify({ format: 'sharpforge-workspace', version: 1, ...settings }, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new RangeError('Workspace manifest limit exceeded');
  return text;
}
