export const responsiveViewportMarker = '// SharpForge adaptive viewport v1';

/** A named method group stays in the executable framework-delegate profile; captured targets require an explicit caller. */
export function responsiveViewportEmission(options, methodName) {
  if (!options.viewport || options.parameters?.length) return {
    methods: [], initialize: [], diagnostics: [{code: 'SFD_RESPONSIVE_HOST_RESIZE', severity: 'info', span: {start: 0, length: 0},
      message: `Call ${methodName}(width) from the application viewport resize callback. `
        + 'Automatic Window.SizeChanged requires a Window and static-field targets; captured framework delegates are unsupported.'}]
  };
  const {window, handlerName = 'OnAdaptiveSizeChanged'} = options.viewport;
  return {
    methods: [`    private static void ${handlerName}(object sender, Microsoft.UI.Xaml.WindowSizeChangedEventArgs args)`,
      '    {', '        ' + responsiveViewportMarker, `        ${methodName}(args.Size.Width);`, '    }'],
    initialize: [`${window}.SizeChanged += ${handlerName};`], diagnostics: []
  };
}
