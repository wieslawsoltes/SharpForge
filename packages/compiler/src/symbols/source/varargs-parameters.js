import {DiagnosticId} from '../../diagnostics/codes.js';

/** The __arglist marker is metadata calling convention, never a source parameter slot. */
export function fixedSourceParameters(builder, list, uri, owner) {
  const parameters = list?.parameters ?? [];
  const fixed = [];
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index];
    if (parameter.identifier.valueText !== '__arglist') {
      fixed.push(parameter);
      continue;
    }
    if (index !== parameters.length - 1) builder.report(uri, parameter, DiagnosticId.CS0257);
    if (!owner || owner.isVararg) builder.report(uri, parameter, DiagnosticId.CS1669);
    if (owner) {
      owner.isVararg = true;
      if (owner.typeParameters?.length || owner.containingType?.arity || fixed.some(p => p.modifiers.some(t => t.valueText === 'params')))
        builder.report(uri, parameter, DiagnosticId.CS0224);
      if (owner.isAsync) builder.report(uri, parameter, DiagnosticId.CS4006);
    }
  }
  return fixed;
}
