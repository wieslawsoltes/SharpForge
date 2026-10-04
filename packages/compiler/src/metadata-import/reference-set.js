/**
 * A set of reference assemblies decoded once and shared by many compilations.
 *
 * `compile`, `compileToAssembly` and `SemanticAnalysis` take `references` as `{ bytes }` entries and import them on
 * every call. The .NET reference pack is about 170 assemblies, and importing them costs far more than binding a
 * small program against them, so a host that compiles repeatedly (a language service, a test corpus, a build of
 * several projects) creates one set and passes it as `references` to every compilation.
 *
 * The set is an explicit object owned by the caller: there is no process-wide cache. Imported symbols resolve their
 * cross-assembly references through the set they were bound in, so one set must always be used as a whole; build a
 * second set for a different combination of assemblies. The set also keeps the result of binding its assemblies to
 * each other (identity unification, type forwarders, the merged namespaces), which is the same for every compilation.
 */
import { CilError } from '@sharpforge/cil';
import { importAssembly } from './pe-symbols.js';

/** A reference set never holds more assemblies than this; a larger input is a host error, not a program. */
export const MAX_REFERENCE_ASSEMBLIES = 4096;

const BINDING = Symbol('SharpForge.referenceSetBinding');

const isImageError = error => error instanceof CilError || error instanceof RangeError || error instanceof TypeError;

/**
 * Decodes reference assemblies for reuse.
 * @param {{bytes: Uint8Array, display?: string, aliases?: string[], options?: object}[]} entries the images, in
 *   reference order; `display` is the name diagnostics show, `aliases` the extern aliases, `options` the import
 *   options of `importAssembly`
 * @returns {object[]} a frozen array to pass as the `references` compilation option. An image that cannot be decoded
 *   stays a `{ bytes }` entry, so every compilation that uses the set reports CS0009 for it.
 * @throws {RangeError} when there are more than `MAX_REFERENCE_ASSEMBLIES` entries
 */
export function createReferenceSet(entries) {
  const list = [...entries];
  if (list.length > MAX_REFERENCE_ASSEMBLIES) {
    throw new RangeError(`A reference set holds at most ${MAX_REFERENCE_ASSEMBLIES} assemblies, not ${list.length}`);
  }
  const set = list.map(importEntry);
  // The assemblies of a set are bound to each other once, by the first compilation that uses it (`boundReferenceSet`).
  Object.defineProperty(set, BINDING, { value: { bound: null }, enumerable: false });
  return Object.freeze(set);
}

/**
 * The binding of a reference set - what binding its assemblies to each other produced - computed by `bind` on first
 * use and kept on the set. Any other list of references is bound on every call.
 * @param {object[]} references the `references` option of a compilation  @param {() => object} bind
 */
export function boundReferenceSet(references, bind) {
  const holder = references[BINDING];
  if (!holder) return bind();
  return (holder.bound ??= bind());
}

function importEntry(entry, index) {
  const display = entry.display ?? `<reference ${index + 1}>`;
  try {
    const assembly = importAssembly(entry.bytes, { filePath: display, ...entry.options });
    return Object.freeze({ assembly, display, aliases: entry.aliases });
  } catch (error) {
    if (!isImageError(error)) throw error;
    return Object.freeze({ ...entry, display });
  }
}
