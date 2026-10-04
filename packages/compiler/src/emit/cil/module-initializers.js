/**
 * Module initializers (C# 9, SF-A02-T30): the methods marked `[ModuleInitializer]` run once, in declaration order,
 * before any other code of the module. The type initializer of `<Module>` calls them, as in a Roslyn build: the
 * runtime runs it before anything else, so also before the type initializer of the entry point's type.
 *
 * It is declared only for a program whose entry point type has a type initializer. Otherwise the entry point calls
 * the module initializers first (emit-objects.js), which is the same order and also runs on the direct-CIL runtime,
 * which does not run `<Module>::.cctor`.
 */
import { MethodImplAttributes } from '@sharpforge/cil';
import { IlBuilder } from './il-builder.js';

/**
 * The planned methods of `<Module>`.
 * @param analysis the analysed compilation  @param {number} flags the flags of a type initializer
 * @returns {object[]} the planned `<Module>::.cctor`, or nothing for a program without module initializers
 */
export function moduleTypeInitializer(analysis, flags) {
  const initializers = analysis.assembly.moduleInitializers ?? [];
  if (!initializers.length) return [];
  return [
    {
      symbol: null,
      name: '.cctor',
      flags,
      implFlags: MethodImplAttributes.IL,
      hasBody: true,
      isCompilerGenerated: true,
      shape: { isStatic: true, returnType: analysis.core.void, parameters: [] },
      parameters: [],
      emitBody: program => {
        const il = new IlBuilder();
        for (const initializer of initializers) il.emit('call', program.tokens.method(initializer), { pops: 0, pushes: 0 });
        return il.emit('ret', undefined, { pops: 0, pushes: 0 });
      },
    },
  ];
}
