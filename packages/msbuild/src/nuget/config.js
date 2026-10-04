import { parseXml } from '@sharpforge/project-system';

function mergeSection(destination, section, sourcePath) {
  for (const item of section?.children ?? []) {
    if (item.name === 'clear') destination.clear();
    else if (item.name === 'remove') destination.delete(item.attributes.key);
    else if (item.name === 'add') {
      const { key, value } = item.attributes;
      if (!key || value === undefined) throw new Error('NuGet configuration entry requires key and value');
      destination.set(key, { value, ...item.attributes, sourcePath });
    }
  }
}

function localSource(value, sourcePath) {
  const normalized = value.replaceAll('\\', '/');
  if (!sourcePath || /^([a-z][a-z0-9+.-]*:|\/)/i.test(normalized)) return value;
  const file = sourcePath.replaceAll('\\', '/');
  if (!/^(\/|[a-z]:\/)/i.test(file)) return value;
  const url = new URL(normalized, 'file://' + (file.startsWith('/') ? '' : '/') + file);
  const path = decodeURIComponent(url.pathname);
  return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
}

const visibleSettings = new Set(['globalpackagesfolder', 'repositorypath', 'dependencyversion', 'defaultpushsource',
  'signaturevalidationmode', 'maxhttprequestspersource', 'updatepackagelastaccesstime']);
export function redactFeedUrl(value) {
  if (/^(?:[a-z]:[\\/]|[\\/])/i.test(value)) return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of url.searchParams.keys()) url.searchParams.set(key, '[redacted]');
    return url.href;
  } catch { return value; }
}

/** Merge machine/user/ancestor/project NuGet.Config records in precedence order; credentials are never retained. */
export function parseNuGetConfiguration(records) {
  if (!Array.isArray(records) || records.length > 128) throw new Error('NuGet configuration hierarchy limit exceeded');
  const sources = new Map(), disabled = new Map(), fallback = new Map(), configuration = new Map(), mappings = new Map();
  const credentials = new Set(), paths = [];
  for (const record of records) {
    const root = parseXml(record.text, { maxLength: 2097152 });
    if (root.name !== 'configuration') throw new Error('NuGet.Config root must be configuration');
    paths.push(record.path);
    for (const section of root.children) {
      if (section.name === 'packageSources') mergeSection(sources, section, record.path);
      else if (section.name === 'disabledPackageSources') mergeSection(disabled, section);
      else if (section.name === 'fallbackPackageFolders') mergeSection(fallback, section);
      else if (section.name === 'config') mergeSection(configuration, section);
      else if (section.name === 'packageSourceCredentials') {
        for (const source of section.children) credentials.add(source.name.replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16))));
      } else if (section.name === 'packageSourceMapping') {
        for (const source of section.children) {
          if (source.name === 'clear') { mappings.clear(); continue; }
          if (source.name !== 'packageSource' || !source.attributes.key) throw new Error('Invalid package source mapping');
          const patterns = source.children.filter(item => item.name === 'package').map(item => item.attributes.pattern);
          if (patterns.some(pattern => !pattern || !/^[A-Za-z0-9_.\-*]+$/.test(pattern))) throw new Error('Invalid package mapping pattern');
          mappings.set(source.attributes.key, patterns);
        }
      }
    }
  }
  return { sources: [...sources].map(([name, entry]) => ({ name, url: redactFeedUrl(localSource(entry.value, entry.sourcePath)),
    enabled: disabled.get(name)?.value.toLowerCase() !== 'true', protocolVersion: entry.protocolVersion ?? null,
    hasCredentials: credentials.has(name), patterns: mappings.get(name) ?? [] })),
    fallbackPackageFolders: [...fallback.values()].map(entry => entry.value),
    config: Object.fromEntries([...configuration].filter(([key]) => visibleSettings.has(key.toLowerCase()))
      .map(([key, entry]) => [key, redactFeedUrl(entry.value)])),
    omittedConfigurationKeys: [...configuration.keys()].filter(key => !visibleSettings.has(key.toLowerCase())),
    paths, credentialsPresent: credentials.size > 0 };
}

export function sourcesForPackage(configuration, packageId) {
  const id = packageId.toLowerCase();
  const mappingEnabled = configuration.sources.some(source => source.patterns.length);
  const candidates = configuration.sources.filter(source => source.enabled).map(source => {
    let specificity = -1;
    for (const pattern of source.patterns) {
      const lower = pattern.toLowerCase();
      if (lower === id) specificity = Math.max(specificity, 100000 + lower.length);
      else if (lower === '*' || lower.endsWith('*') && id.startsWith(lower.slice(0, -1))) specificity = Math.max(specificity, lower.length - 1);
    }
    return { source, specificity };
  });
  const best = Math.max(...candidates.map(item => item.specificity));
  return candidates.filter(item => !mappingEnabled || best >= 0 && item.specificity === best).map(item => item.source);
}
