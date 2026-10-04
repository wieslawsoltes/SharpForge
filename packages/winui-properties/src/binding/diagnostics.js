export const BindingDiagnosticCode = Object.freeze({
  InvalidPath: 'SFB001', MissingSource: 'SFB002', MissingMember: 'SFB003', InvalidIndex: 'SFB004',
  ConverterFailure: 'SFB005', ConversionFailure: 'SFB006', SourceUpdateFailure: 'SFB007',
  Cycle: 'SFB008', InvalidTarget: 'SFB009', Lifetime: 'SFB010'
});

/** Structured binding diagnostics contain identities and positions, never source values. */
export function bindingDiagnostic(code, {path = '', step = null, sourceType = null, targetProperty = null, message = ''} = {}) {
  return Object.freeze({code, severity: 'warning', path, step, sourceType, targetProperty, message, valuesRedacted: true});
}
