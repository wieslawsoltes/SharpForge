import { getCaseInsensitive, setCaseInsensitive, toBoolean } from './errors.js';

function promoteGlobalReferences({ versions, references, globals }) {
  for (const item of globals) {
    versions.push({ ...item, itemType: 'PackageVersion', metadata: { ...item.metadata } });
    const metadata = { ...item.metadata };
    setCaseInsensitive(metadata, 'Version', '');
    setCaseInsensitive(metadata, 'IncludeAssets', 'Runtime;Build;Native;contentFiles;Analyzers');
    setCaseInsensitive(metadata, 'PrivateAssets', 'All');
    references.push({ ...item, itemType: 'PackageReference', metadata });
  }
}

/** Apply evaluated central/global package metadata while retaining NuGet's blocking version-policy diagnostics. */
export function evaluateCentralPackages(context, items) {
  if (toBoolean(context.properties.restoreenableglobalpackagereference, true)) promoteGlobalReferences(items);
  const versions = new Map(items.versions.map(item => [item.identity.toLowerCase(), getCaseInsensitive(item.metadata, 'Version')]));
  for (const item of items.references) {
    const direct = getCaseInsensitive(item.metadata, 'Version');
    const override = getCaseInsensitive(item.metadata, 'VersionOverride');
    const central = versions.get(item.identity.toLowerCase());
    if (direct) {
      context.diagnostic(`PackageReference '${item.identity}' cannot specify Version while central package management is enabled.`, null, 'NU1008');
    } else if (override && !toBoolean(context.properties.centralpackageversionoverrideenabled, true)) {
      context.diagnostic(`VersionOverride is disabled for '${item.identity}'.`, null, 'NU1013');
    } else if (override || central) {
      setCaseInsensitive(item.metadata, 'Version', override || central);
    } else {
      context.diagnostic(`PackageReference '${item.identity}' has no matching central PackageVersion.`, null, 'NU1010');
    }
  }
}
