/**
 * The pinned Roslyn semantic-model answers (SF-A02-T38): `pinned.json`, written by tools/pin.mjs, and the content
 * hash that ties each program to its pin, so an edited program with a stale pin is detected.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/** Stable content hash of what Roslyn was shown for a program. */
export function programHash(program) {
  return createHash('sha256')
    .update((program.langVersion ?? '') + '\0' + program.source)
    .digest('hex')
    .slice(0, 16);
}

/**
 * The pins: `{roslyn, programs: {id: {hash, expressions, declarations}}}` with rows as objects.
 * An expression row is `{start, end, syntaxKind, symbolKind, methodKind, name, display, type, convertedType, constant}`
 * (`constant` is `{value}` or null); a declaration row is `{start, end, syntaxKind, symbolKind, name, display}`.
 */
export function loadPinned() {
  const document = JSON.parse(readFileSync(join(root, 'pinned.json'), 'utf8')),
    programs = {};
  for (const [id, pinned] of Object.entries(document.programs)) {
    programs[id] = {
      hash: pinned.hash,
      expressions: pinned.expressions.map(([start, length, syntaxKind, symbolKind, methodKind, name, display, type, convertedType, constant]) => ({
        start,
        end: start + length,
        syntaxKind,
        symbolKind,
        methodKind,
        name,
        display,
        type,
        convertedType,
        constant: constant ? { value: constant[0] } : null,
      })),
      declarations: pinned.declarations.map(([start, length, syntaxKind, symbolKind, name, display]) => ({
        start,
        end: start + length,
        syntaxKind,
        symbolKind,
        name,
        display,
      })),
    };
  }
  return { roslyn: document.roslyn, programs };
}
