import {resolve} from 'node:path';
import {boundedRead, isMain, localPath, readJSON, repository, sha256, sourceExclusions, walkFiles} from './files.js';

const assetPattern = /\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|eot|mp[34]|wav|ogg|pdf|zip|tgz|dll|pdb)$/i;

/** Files needing an explicit origin record; original source remains under repository MIT. */
export function needsOrigin(path) {
  return assetPattern.test(path) || /(?:^|\/)(?:vendor|third[_-]?party|external)(?:\/)/i.test(path)
    || path.startsWith('planning/qualification/supply/cyclonedx/');
}

/** Enforce exact asset coverage, allowed licenses, retained notices and immutable asset bytes. */
export async function licenseGate({root = repository, policy, signal} = {}) {
  policy ??= await readJSON(localPath(root, 'planning/qualification/supply/licenses.json'), {root, signal});
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.allowed) || !Array.isArray(policy.files)) {
    throw new Error('LICENSE_POLICY: invalid policy');
  }
  const files = await walkFiles(root, {signal, exclude: sourceExclusions});
  const covered = new Map();
  const licenseTexts = new Map();
  const notices = (await boundedRead(localPath(root, 'THIRD_PARTY_NOTICES.md'), {root, signal})).toString('utf8');
  for (const entry of policy.files) {
    if (covered.has(entry.path) || !entry.origin || !entry.notice || !policy.allowed.includes(entry.license)) {
      throw new Error('LICENSE_POLICY: duplicate, missing origin or disallowed license for ' + entry.path);
    }
    covered.set(entry.path, entry);
    const bytes = await boundedRead(localPath(root, entry.path), {root, signal});
    if (sha256(bytes) !== entry.sha256) throw new Error('LICENSE_HASH: changed asset ' + entry.path);
    if (!notices.includes(entry.notice)) throw new Error('LICENSE_NOTICE: missing notice for ' + entry.path);
    if (!licenseTexts.has(entry.licenseFile)) {
      licenseTexts.set(entry.licenseFile, await boundedRead(localPath(root, entry.licenseFile), {root, signal}));
    }
    const license = licenseTexts.get(entry.licenseFile);
    if (!license.length || (entry.licenseSHA256 && sha256(license) !== entry.licenseSHA256)) {
      throw new Error('LICENSE_TEXT: missing or changed license for ' + entry.path);
    }
  }
  for (const path of files) {
    if (needsOrigin(path) && !covered.has(path)) throw new Error('LICENSE_UNLISTED: ' + path);
  }
  return {schemaVersion: 1, status: 'pass', files: covered.size, allowed: policy.allowed,
    scope: 'Explicit asset/vendor origins and notices; license classification is a reviewed declaration, not automated authorship discovery'};
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(await licenseGate({root: resolve(process.argv[2] || repository)}), null, 2));
}
