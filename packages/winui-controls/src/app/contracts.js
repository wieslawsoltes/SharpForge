export function registerApplicationContracts(b) {
  const { X, C } = b, W = 'Microsoft.UI.Windowing.', D = 'Windows.ApplicationModel.DataTransfer.';
  b.type(W + 'AppWindow');
  b.type(W + 'AppWindowPresenter');
  for (const name of ['OverlappedPresenter', 'FullScreenPresenter', 'CompactOverlayPresenter']) {
    b.type(W + name, W + 'AppWindowPresenter'); b.method(W + name, 'Create', [], W + name, { isStatic: true });
  }
  b.enumeration(W + 'AppWindowPresenterKind', { Default: 0, CompactOverlay: 1, FullScreen: 2, Overlapped: 3 });
  b.type(W + 'AppWindowTitleBar');
  b.props(W + 'AppWindowTitleBar', { ExtendsContentIntoTitleBar: ['bool', false], PreferredHeightOption: ['int', 0],
    ButtonBackgroundColor: 'Windows.UI.Color', ButtonForegroundColor: 'Windows.UI.Color' });
  b.method(W + 'AppWindowTitleBar', 'IsCustomizationSupported', [], 'bool', { isStatic: true });
  b.props(X + 'Window', { AppWindow: [W + 'AppWindow', null, true], Bounds: ['Windows.Foundation.Rect', null, true],
    Visible: ['bool', false, true], ExtendsContentIntoTitleBar: ['bool', false], DispatcherQueue: ['object', null, true] });
  b.method(X + 'Window', 'SetTitleBar', [X + 'UIElement']);
  b.method(X + 'Window', 'CloseAsync', [], b.task('bool'));
  for (const [name, fields] of [['Activated', { WindowActivationState: 'int' }], ['SizeChanged', { Size: 'Windows.Foundation.Size' }],
    ['VisibilityChanged', { Visible: 'bool' }], ['Closing', { Cancel: 'bool' }], ['Closed', { Handled: 'bool' }]]) {
    b.event(X + 'Window', name, fields, { deferral: name === 'Closing' });
  }
  b.props(W + 'AppWindow', { Title: ['string', ''], Position: ['Windows.Foundation.Point', null, true],
    Size: ['Windows.Foundation.Size', null, true], IsVisible: ['bool', false, true],
    Presenter: [W + 'AppWindowPresenter', null, true], TitleBar: [W + 'AppWindowTitleBar', null, true] });
  b.method(W + 'AppWindow', 'Resize', ['Windows.Foundation.Size']);
  b.method(W + 'AppWindow', 'Move', ['Windows.Foundation.Point']);
  for (const name of ['Show', 'Hide']) b.method(W + 'AppWindow', name);
  b.method(W + 'AppWindow', 'DestroyAsync', [], b.task('bool'));
  b.method(W + 'AppWindow', 'SetPresenterAsync', [W + 'AppWindowPresenterKind'], b.task());
  b.event(W + 'AppWindow', 'Changed', { DidSizeChange: 'bool', DidPositionChange: 'bool', DidVisibilityChange: 'bool', DidPresenterChange: 'bool' });
  b.event(W + 'AppWindow', 'Closing', { Cancel: 'bool' }, { deferral: true });
  b.event(W + 'AppWindow', 'Destroying');
  b.props(X + 'Application', { Resources: 'object', RequestedTheme: ['int', 0], HighContrastAdjustment: ['int', 0] });
  b.event(X + 'Application', 'UnhandledException', { Exception: 'object', Message: 'string', Handled: 'bool' });
  b.event(X + 'Application', 'Suspending', { Cancel: 'bool', Persisted: 'bool', State: 'object' }, { deferral: true });
  b.event(X + 'Application', 'Resuming', { Persisted: 'bool', State: 'object' });
  b.events(X + 'Application', ['Resuming', 'LeavingBackground', 'EnteredBackground', 'Launched', 'Activated']);
  b.method(X + 'Application', 'SuspendAsync', [], b.task('bool'));
  b.method(X + 'Application', 'Resume');
  const A = 'Microsoft.Windows.AppLifecycle.';
  b.type(A + 'AppInstance'); b.method(A + 'AppInstance', 'GetCurrent', [], A + 'AppInstance', { isStatic: true });
  b.method(A + 'AppInstance', 'GetActivatedEventArgs', [], A + 'AppActivationArguments');
  b.type(A + 'AppActivationArguments'); b.props(A + 'AppActivationArguments', { Kind: ['int', 0, true], Data: ['object', null, true] });
  b.type('SharpForge.UI.ActivationData');
  b.props('SharpForge.UI.ActivationData', { Arguments: ['string', ''], Uri: ['string', ''], Files: ['object[]', null] });
  b.event(A + 'AppInstance', 'Activated', { Arguments: A + 'AppActivationArguments' });
  b.method(A + 'AppInstance', 'FindOrRegisterForKey', ['string'], A + 'AppInstance', { isStatic: true });
  b.method(A + 'AppInstance', 'RedirectActivationToAsync', [A + 'AppActivationArguments'], b.task());
  b.type(D + 'DataPackage'); b.type(D + 'DataPackageView');
  b.props(D + 'DataPackage', { RequestedOperation: ['int', 0] });
  for (const name of ['Text', 'Html', 'Uri']) {
    b.method(D + 'DataPackage', 'Set' + name, ['string']);
    b.method(D + 'DataPackageView', 'Get' + name + 'Async', [], b.task('string'));
  }
  b.method(D + 'DataPackage', 'GetView', [], D + 'DataPackageView');
  b.method(D + 'DataPackageView', 'Contains', ['string'], 'bool');
  b.property(D + 'DataPackageView', 'AvailableFormats', 'string[]', null, true);
  b.type(D + 'StandardDataFormats', 'object', 'static', []);
  for (const name of ['Text', 'Html', 'Uri']) b.property(D + 'StandardDataFormats', name, 'string', name, true, true);
  b.type(D + 'Clipboard', 'object', 'static', []);
  b.method(D + 'Clipboard', 'SetContentAsync', [D + 'DataPackage'], b.task('bool'), { isStatic: true });
  b.method(D + 'Clipboard', 'GetContentAsync', [], b.task(D + 'DataPackageView'), { isStatic: true });
  b.type('Windows.System.Launcher', 'object', 'static', []);
  b.method('Windows.System.Launcher', 'LaunchUriAsync', ['string'], b.task('bool'), { isStatic: true });
  const R = 'Microsoft.Windows.ApplicationModel.Resources.ResourceLoader';
  b.type(R, 'object', 'object', [[], ['string']]); b.method(R, 'GetString', ['string'], 'string');
  b.method(R, 'GetForViewIndependentUse', [], R, { isStatic: true });
  b.property(R, 'Language', 'string', 'en-US');
  b.type('Windows.ApplicationModel.Resources.ResourceLoader');
  b.method('Windows.ApplicationModel.Resources.ResourceLoader', 'GetString', ['string'], 'string');
  b.method('Windows.ApplicationModel.Resources.ResourceLoader', 'GetForCurrentView', [],
    'Windows.ApplicationModel.Resources.ResourceLoader', { isStatic: true });
  b.property(X + 'FrameworkElement', 'Uid', 'string', '');
  registerResourceManagerContracts(b);
}

function registerResourceManagerContracts(b) {
  const R = 'Microsoft.Windows.ApplicationModel.Resources.';
  b.type(R + 'ResourceManager', 'object', 'object', [[], ['string']]);
  b.type(R + 'ResourceMap', 'object', 'object', []);
  b.type(R + 'ResourceCandidate', 'object', 'object', []);
  b.type(R + 'ResourceContext');
  b.property(R + 'ResourceManager', 'MainResourceMap', R + 'ResourceMap', null, true);
  b.method(R + 'ResourceManager', 'CreateResourceContext', [], R + 'ResourceContext');
  b.method(R + 'ResourceMap', 'GetValue', ['string'], R + 'ResourceCandidate');
  b.method(R + 'ResourceMap', 'GetValue', ['string', R + 'ResourceContext'], R + 'ResourceCandidate');
  b.method(R + 'ResourceMap', 'GetSubtree', ['string'], R + 'ResourceMap');
  b.props(R + 'ResourceCandidate', { Kind: ['int', 0, true], ValueAsString: ['string', '', true] });
  b.property(R + 'ResourceContext', 'Language', 'string', 'en-US');
  b.method(R + 'ResourceContext', 'SetQualifierValue', ['string', 'string']);
  b.method(R + 'ResourceContext', 'GetQualifierValue', ['string'], 'string');
}
