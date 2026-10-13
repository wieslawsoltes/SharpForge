import { parseXml } from '@sharpforge/project-system';

/** Resolve evaluated central items; conditioned/imported properties must first come from the selected project context. */
export function resolveCentralPackages(references, central, { allowVersionOverride = true } = {}) {
  const versions = new Map((central.packageVersions ?? []).map(item => [item.id.toLowerCase(), item]));
  const diagnostics = [], resolved = [];
  const globals = (central.globalPackageReferences ?? []).map(reference => ({ ...reference, global: true }));
  for (const reference of [...references, ...globals]) {
    const version = reference.global ? reference.version : reference.versionOverride && allowVersionOverride ?
      reference.versionOverride : versions.get(reference.id.toLowerCase())?.version;
    if (!version) diagnostics.push({ code: 'NU1010', severity: 'error', packageId: reference.id,
    message: 'No central PackageVersion exists for ' + reference.id });
    if (reference.version && !reference.global) diagnostics.push({ code: 'NU1008', severity: 'error', packageId: reference.id,
      message: 'Centrally managed PackageReference must not specify Version' });
    if (reference.versionOverride && !allowVersionOverride) diagnostics.push({ code: 'NU1013', severity: 'error', packageId: reference.id,
      message: 'VersionOverride is disabled by CentralPackageVersionOverrideEnabled' });
    resolved.push({ ...reference, version: version ?? null, centrallyManaged: true });
  }
  return { references: resolved, diagnostics, transitivePinning: central.transitivePinning === true };
}

export function parseCentralPackages(text) {
  const root = parseXml(text), packageVersions = [], globalPackageReferences = [], properties = Object.create(null);
  if (root.name !== 'Project') throw new Error('Directory.Packages.props root must be Project');
  for (const group of root.children) {
    if (!['PropertyGroup', 'ItemGroup'].includes(group.name)) {
      throw new Error('Central package ' + group.name + ' requires evaluated native or portable project context');
    }
    if (group.attributes.Condition) throw new Error('Conditioned central package groups require evaluated native or portable project context');
    if (group.name === 'PropertyGroup') for (const child of group.children) {
      if (child.attributes.Condition || /[$@%]\(/.test(child.text)) throw new Error('Central package properties require evaluated context');
      properties[child.name] = child.text;
    }
    if (group.name !== 'ItemGroup') continue;
    for (const item of group.children) {
      if (!['PackageVersion', 'GlobalPackageReference'].includes(item.name)) continue;
      if (item.attributes.Condition) throw new Error('Conditioned central packages require evaluated context');
      if (item.children.some(child => child.attributes.Condition)) throw new Error('Conditioned central package metadata requires evaluated context');
      const metadata = Object.fromEntries(item.children.map(child => [child.name, child.text]));
      const record = { id: item.attributes.Include ?? item.attributes.Update, version: item.attributes.Version ?? metadata.Version };
      if (!record.id || !record.version || /[$@%]\(/.test(record.id + record.version)) {
        throw new Error('Central package record requires evaluated id and version');
      }
      (item.name === 'PackageVersion' ? packageVersions : globalPackageReferences).push(record);
    }
  }
  return { packageVersions, globalPackageReferences, transitivePinning: properties.CentralPackageTransitivePinningEnabled === 'true', properties };
}
