import {CilError, Reader} from '../binary.js';
import {memberDefinitionProfile} from '../metadata/member-definitions.js';

const maximumResourceBytes = 64 * 1024 * 1024;

function requireProfile(condition, message) {
  if (!condition) throw new CilError('Invalid project metadata profile: ' + message);
}

function typeDefinitions(profile, image) {
  requireProfile(Array.isArray(profile.types) && profile.types.length === image.types.length, 'type count');
  const definitions = Object.create(null);
  profile.types.forEach((type, index) => {
    requireProfile(type?.id === index && ['public', 'internal'].includes(type.access), 'type identity or visibility');
    requireProfile(typeof type.name === 'string' && type.name.length > 0 && type.name.length <= 1024
      && typeof type.namespace === 'string' && type.namespace.length <= 1024, 'type name');
    definitions[image.types[index].name] = {name: type.name, namespace: type.namespace, access: type.access};
  });
  return definitions;
}

function resourceInputs(profile, pe) {
  const rows = pe.metadata.rows[40] ?? [];
  requireProfile(Array.isArray(profile.resources) && profile.resources.length <= 4096
    && profile.resources.length === rows.length, 'resource count');
  requireProfile(pe.resources.size <= maximumResourceBytes, 'resource directory size');
  if (!rows.length) return [];
  const directory = pe.offsetOf(pe.resources.rva, pe.resources.size);
  let total = 0;
  return profile.resources.map((resource, index) => {
    const row = rows[index];
    requireProfile(resource && typeof resource.manifestName === 'string' && typeof resource.isPublic === 'boolean'
      && Number.isSafeInteger(resource.length) && resource.length >= 0, 'resource descriptor');
    requireProfile(row[3] === 0 && row[1] === (resource.isPublic ? 1 : 2)
      && pe.metadata.string(row[2]) === resource.manifestName, 'resource identity');
    requireProfile(row[0] + 4 <= pe.resources.size && resource.length <= pe.resources.size - row[0] - 4, 'resource range');
    const reader = new Reader(pe.bytes, directory + row[0], resource.length + 4);
    requireProfile(reader.u32() === resource.length, 'resource byte length');
    total += resource.length + 12;
    requireProfile(total <= maximumResourceBytes, 'resource byte limit');
    return {manifestName: resource.manifestName, isPublic: resource.isPublic, bytes: reader.take(resource.length)};
  });
}

/** Recover only bounded, non-executable project options; canonical re-emission still checks every original byte. */
export function projectEmissionOptions(pe, debug, image) {
  const profile = debug.projectMetadata;
  if (profile === undefined) return {};
  requireProfile(profile && profile.version === 1 && !Array.isArray(profile), 'version');
  const options = {};
  if (profile.assemblyAttributes !== undefined) {
    requireProfile(Array.isArray(profile.assemblyAttributes) && profile.assemblyAttributes.length <= 256, 'attribute count');
    options.assemblyAttributes = profile.assemblyAttributes;
  }
  if (profile.assemblyCulture !== undefined) options.assemblyCulture = profile.assemblyCulture;
  if (profile.types !== undefined) options.typeDefinitions = typeDefinitions(profile, image);
  if (profile.memberDefinitions !== undefined) options.memberDefinitions = memberDefinitionProfile(image, profile.memberDefinitions);
  if (profile.resources !== undefined) options.resources = resourceInputs(profile, pe);
  return options;
}
