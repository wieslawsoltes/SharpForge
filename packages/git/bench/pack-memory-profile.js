export const PACK_MEMORY_PROFILE = Object.freeze({ objects: 128, objectBytes: 819200, algorithm: 'sha1', seed: 0x0a251608 });
export const PACK_MEMORY_MINIMUM_BYTES = 100 * 1024 * 1024;
export const PACK_MEMORY_HEAP_LIMIT_BYTES = 64 * 1024 * 1024;

/** Validate a bounded, deterministic pack fixture; reduced profiles never qualify the 100 MiB obligation. */
export function packMemoryProfile(options = {}) {
  const profile = Object.fromEntries(Object.entries(PACK_MEMORY_PROFILE).map(([key, value]) => [key, options[key] ?? value]));
  const ranges = { objects: [1, 8192], objectBytes: [1, 2 * 1024 * 1024], seed: [1, 0xffffffff] };
  for (const [name, [minimum, maximum]] of Object.entries(ranges)) {
    if (!Number.isSafeInteger(profile[name]) || profile[name] < minimum || profile[name] > maximum) {
      throw new RangeError(`Invalid pack memory ${name}`);
    }
  }
  if (!['sha1', 'sha256'].includes(profile.algorithm)) throw new RangeError('Invalid pack memory object format');
  if (profile.objects * profile.objectBytes > 1024 ** 3) throw new RangeError('Pack memory fixture exceeds one GiB');
  return profile;
}
