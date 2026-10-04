/**
 * Nullable annotations and contexts (SF-A02-T05.3).
 *
 * `NullableContextMap` answers "which nullable context is in effect at this position" from the `#nullable` directive
 * trivia of a file and the compilation default (`/nullable`). `annotate` turns the syntax fact "the type was written
 * with `?`" into a NullableAnnotation for that context: annotated, not annotated, or oblivious when annotations are
 * disabled. `encodeNullableFlags` / `decodeNullableFlags` are the metadata form Roslyn emits in NullableAttribute
 * (one byte per type in pre-order: 0 oblivious, 1 not annotated, 2 annotated; non-generic value types have no byte),
 * and `nullableContextFlag` chooses the NullableContextAttribute value of a scope (its most common byte).
 */
import { NullableAnnotation, TypeWithAnnotations } from '../symbols/types.js';
export {
  encodeNullableFlags, decodeNullableFlags, compactNullableFlags, nullableContextFlag, nullableAttributeFor,
} from './metadata-flags.js';

/** The four `/nullable` settings as the two independent switches they stand for. */
export const nullableSettings = Object.freeze({
  disable: Object.freeze({ annotations: false, warnings: false }),
  enable: Object.freeze({ annotations: true, warnings: true }),
  warnings: Object.freeze({ annotations: false, warnings: true }),
  annotations: Object.freeze({ annotations: true, warnings: false }),
});

/** The nullable context of one file as a function of position. */
export class NullableContextMap {
  /**
   * @param {object[]} directives directive trivia of the file (`parse().directives`); only active `#nullable` ones count
   * @param {'disable'|'enable'|'warnings'|'annotations'} defaultContext the compilation-wide setting
   */
  constructor(directives = [], defaultContext = 'disable') {
    const initial = nullableSettings[defaultContext] ?? nullableSettings.disable;
    this.initial = initial;
    this.entries = [];
    let current = { ...initial };
    for (const d of [...directives].sort((a, b) => a.end - b.end)) {
      const s = d.structure;
      if (!s || s.directive !== 'nullable' || s.isActive === false || !s.setting) continue;
      const value = s.setting === 'enable' ? true : s.setting === 'disable' ? false : null,
        next = { ...current };
      for (const key of s.target ? [s.target] : ['annotations', 'warnings'])
        if (key in next) next[key] = value === null ? initial[key] : value;
      current = next;
      this.entries.push({ position: d.end, state: Object.freeze(next) });
    }
    Object.freeze(this);
  }
  /** `{annotations,warnings}` in effect at `position`. */
  stateAt(position) {
    let low = 0,
      high = this.entries.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.entries[mid].position <= position) low = mid + 1;
      else high = mid;
    }
    return low ? this.entries[low - 1].state : this.initial;
  }
  annotationsEnabledAt(position) {
    return this.stateAt(position).annotations;
  }
  warningsEnabledAt(position) {
    return this.stateAt(position).warnings;
  }
  /** True when any part of the file can produce nullable warnings (lets callers skip the flow walk). */
  get anyWarnings() {
    return this.initial.warnings || this.entries.some(e => e.state.warnings);
  }
}

/** The annotation of a reference type written with (`questionMark`) or without `?` in a context where annotations are on or off. */
export function annotationFor(questionMark, annotationsEnabled) {
  return questionMark ? NullableAnnotation.Annotated : annotationsEnabled ? NullableAnnotation.NotAnnotated : NullableAnnotation.Oblivious;
}
/** Applies `annotationFor` to a type; value types other than Nullable<T> carry no reference annotation. */
export function annotate(type, questionMark, annotationsEnabled) {
  if (type instanceof TypeWithAnnotations) type = type.type;
  if (type.isValueType === true && !type.isNullableValueType)
    return new TypeWithAnnotations(type, annotationsEnabled ? NullableAnnotation.NotAnnotated : NullableAnnotation.Oblivious);
  return new TypeWithAnnotations(type, annotationFor(questionMark, annotationsEnabled));
}
