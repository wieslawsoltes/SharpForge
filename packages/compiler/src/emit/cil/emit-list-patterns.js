/**
 * List patterns (SF-A02-T30): `[p1, .., pn]`, with an optional slice `..` or `.. pattern`.
 *
 *   length test     exactly the number of element patterns, or at least that many when there is a slice
 *   element i       before the slice `input[i]`, after it `input[length - k]`
 *   slice pattern   the elements between, matched against the pattern
 *
 * How the input is counted, indexed and sliced is the shape the binder found (binder/list-pattern-shape.js):
 *
 *   array     `ldlen`, `ldelem`, `RuntimeHelpers.GetSubArray(input, start..^after)`
 *   string    `get_Length`, `get_Chars(int)`, `Substring(int, int)`
 *   members   the `Length` / `Count` property, the indexer `this[int]`, `Slice(int, int)`
 *
 * Elements are read once per run of the tests, like members (emit-patterns.js). A list pattern does not match null.
 */
import { isReference } from './type-facts.js';

const isByReference = member => !!member?.refKind && member.refKind !== 'none';

/** Class mixin: list patterns. */
export const ListPatternEmission = Base =>
  class extends Base {
    matchListPattern(pattern, input, fail) {
      const il = this.il,
        shape = pattern.shape;
      if (!shape) return this.unsupported(`a list pattern over '${input.type?.toDisplayString()}'`, pattern.syntax);
      // The pattern matches the value of a nullable input.
      if (input.type?.isNullableValueType) input = this.nullableValueInput(input, fail);
      const elementType = shape.elementType,
        sliceIndex = pattern.sliceIndex,
        hasSlice = sliceIndex >= 0,
        count = pattern.patterns.length - (hasSlice ? 1 : 0),
        reader = this.listReader(shape, input);
      this.matchNotNull(input, fail);
      const length = this.readOnce(input.slot, 'length', this.core.int, reader.length);
      il.emit('ldloc', length).emit('ldc.i4', count).emit(hasSlice ? 'blt' : 'bne.un', fail);
      pattern.patterns.forEach((element, index) => {
        if (element.kind === 'SlicePattern') return this.matchSlice(element, { input, shape, reader, length, start: index, after: count - index }, fail);
        const fromEnd = hasSlice && index > sliceIndex ? pattern.patterns.length - index : 0,
          pushIndex = () => (fromEnd ? il.emit('ldloc', length).emit('ldc.i4', fromEnd).emit('sub') : il.emit('ldc.i4', index)),
          slot = this.readOnce(input.slot, fromEnd ? 'element:^' + fromEnd : 'element:' + index, elementType, () => reader.element(pushIndex));
        return this.patternMatch(element, { slot, type: elementType }, fail);
      });
      if (pattern.local) {
        il.emit('ldloc', input.slot);
        this.initializeLocal(pattern.local);
      }
      return undefined;
    }
    /**
     * The reads of a list of one shape: `{length(), element(pushIndex), slice(pushStart, pushLength)}`; each leaves
     * its result on the stack. `slice` is absent when the type cannot be sliced.
     */
    listReader(shape, input) {
      const il = this.il,
        type = input.type,
        pushInput = () => il.emit(isReference(type) ? 'ldloc' : 'ldloca', input.slot),
        receiver = { kind: 'Temporary', type };
      if (shape.kind === 'array') {
        return {
          length: () => {
            il.emit('ldloc', input.slot).emit('ldlen').emit('conv.i4');
          },
          element: pushIndex => {
            il.emit('ldloc', input.slot);
            pushIndex();
            this.loadElement(shape.elementType);
          },
        };
      }
      if (shape.kind === 'string') return this.stringReader(input);
      return {
        length: () => {
          pushInput();
          this.callMethod(shape.count.getMethod, { receiver });
        },
        element: pushIndex => {
          pushInput();
          pushIndex();
          this.callMethod(shape.indexer.getMethod, { receiver });
          // `ref T this[int]` (a span): the element is behind the returned address.
          if (isByReference(shape.indexer) || isByReference(shape.indexer.getMethod)) this.loadIndirect(shape.elementType);
        },
        slice: shape.slice
          ? (pushStart, pushLength) => {
              pushInput();
              pushStart();
              pushLength();
              this.callMethod(shape.slice, { receiver });
            }
          : null,
      };
    }
    stringReader(input) {
      const il = this.il,
        { string, int, char } = this.core,
        member = (name, returnType, parameters) => this.tokens.external(string, name, { isStatic: false, returnType, parameters: parameters.map(type => ({ type })) }),
        pushInput = () => il.emit('ldloc', input.slot);
      return {
        length: () => {
          pushInput();
          il.emit('callvirt', member('get_Length', int, []), { pops: 1, pushes: 1 });
        },
        element: pushIndex => {
          pushInput();
          pushIndex();
          il.emit('callvirt', member('get_Chars', char, [int]), { pops: 2, pushes: 1 });
        },
        slice: (pushStart, pushLength) => {
          pushInput();
          pushStart();
          pushLength();
          il.emit('callvirt', member('Substring', string, [int, int]), { pops: 3, pushes: 1 });
        },
      };
    }
    /**
     * `.. pattern`: the elements the slice stands for, matched against its pattern (nothing to do without one).
     * @param {{input, shape, reader, length: number, start: number, after: number}} range `start` elements come before
     *   the slice, `after` follow it; `length` is the local that holds the input's length
     */
    matchSlice(slice, range, fail) {
      if (!slice.pattern) return undefined;
      const { input, shape, start, after } = range,
        type = shape.sliceType;
      if (!type) return this.unsupported(`a slice pattern over '${input.type?.toDisplayString()}'`, slice.syntax);
      const read = shape.kind === 'array' ? () => this.arraySlice(range) : () => this.sliceByLength(range),
        slot = this.readOnce(input.slot, 'slice:' + start + ':' + after, type, read);
      return this.patternMatch(slice.pattern, { slot, type }, fail);
    }
    /** `RuntimeHelpers.GetSubArray(input, start..^after)`. */
    arraySlice({ input, start, after }) {
      const il = this.il,
        index = this.indexType,
        shape = { isStatic: false, returnType: this.core.void, parameters: [{ type: index }, { type: index }] };
      il.emit('ldloc', input.slot).emit('ldc.i4', start);
      this.newIndex(false);
      il.emit('ldc.i4', after);
      this.newIndex(true);
      il.emit('newobj', this.tokens.external(this.rangeType, '.ctor', shape), { pops: 2, pushes: 1 });
      il.emit('call', this.subArrayMethod(input.type.elementType), { pops: 2, pushes: 1 });
    }
    /** `input.Slice(start, length - start - after)` (for a string, `Substring`). */
    sliceByLength({ reader, length, start, after }) {
      const il = this.il;
      reader.slice(
        () => il.emit('ldc.i4', start),
        () => il.emit('ldloc', length).emit('ldc.i4', start + after).emit('sub'),
      );
    }
  };
