export function registerMediaContracts(b) {
  const { X, C } = b, M = X + 'Media.', I = M + 'Imaging.';
  b.type(M + 'ImageSource', X + 'DependencyObject', 'abstract', []);
  b.type(I + 'BitmapSource', M + 'ImageSource', 'abstract', []);
  b.props(I + 'BitmapSource', { PixelWidth: ['int', 0, true], PixelHeight: ['int', 0, true] });
  b.type(I + 'BitmapImage', I + 'BitmapSource', 'object', [[], ['string']]);
  b.type(I + 'SvgImageSource', M + 'ImageSource', 'object', [[], ['string']]);
  b.props(I + 'SvgImageSource', { UriSource: ['string', ''], RasterizePixelWidth: ['double', 0], RasterizePixelHeight: ['double', 0] });
  b.events(I + 'SvgImageSource', ['Opened', 'OpenFailed']);
  b.props(I + 'BitmapImage', { UriSource: ['string', ''], DecodePixelWidth: ['int', 0], DecodePixelHeight: ['int', 0],
    CreateOptions: ['int', 0] });
  b.events(I + 'BitmapImage', ['ImageOpened', 'ImageFailed']);
  b.type(I + 'WriteableBitmap', I + 'BitmapSource', 'object', [['int', 'int']]);
  b.property(I + 'WriteableBitmap', 'PixelBuffer', 'byte[]', null, true);
  b.property(I + 'WriteableBitmap', 'Revision', 'int', 0, true);
  b.method(I + 'WriteableBitmap', 'SetPixels', ['byte[]']); b.method(I + 'WriteableBitmap', 'Invalidate');
  b.props(C + 'Image', { ImageSource: M + 'ImageSource', Stretch: [M + 'Stretch', 2], NineGrid: X + 'Thickness' });
  b.method(C + 'Image', 'SetSource', [M + 'ImageSource']);
  b.event(C + 'Image', 'ImageOpened', { PixelWidth: 'int', PixelHeight: 'int' });
  b.event(C + 'Image', 'ImageFailed', { ErrorMessage: 'string', Code: 'string' });
  b.control('IconElement', X + 'FrameworkElement'); b.type(C + 'IconSource', X + 'DependencyObject', 'abstract', []);
  for (const name of ['FontIcon', 'SymbolIcon', 'PathIcon', 'BitmapIcon', 'ImageIcon', 'IconSourceElement']) {
    b.control(name, C + 'IconElement', { Glyph: ['string', ''], Symbol: ['int', 0], FontFamily: ['string', 'Segoe Fluent Icons'],
      FontSize: ['double', 20], FontWeight: 'object', Data: 'string', Source: M + 'ImageSource', IconSource: C + 'IconSource',
      MirroredWhenRightToLeft: ['bool', false] });
  }
  for (const name of ['FontIconSource', 'SymbolIconSource', 'PathIconSource', 'BitmapIconSource', 'ImageIconSource']) {
    b.type(C + name, C + 'IconSource'); b.props(C + name, { Glyph: 'string', Symbol: 'int', FontFamily: 'string',
      Data: 'string', ImageSource: M + 'ImageSource', UriSource: 'string', Foreground: M + 'Brush' });
  }
  b.control('PersonPicture', C + 'Control', { DisplayName: ['string', ''], Initials: ['string', ''],
    ProfilePicture: M + 'ImageSource', IsGroup: ['bool', false], BadgeNumber: ['int', 0], BadgeText: ['string', ''], BadgeGlyph: ['string', ''] });
  b.event(C + 'PersonPicture', 'ImageOpened', { PixelWidth: 'int', PixelHeight: 'int' });
  b.event(C + 'PersonPicture', 'ImageFailed', { ErrorMessage: 'string', Code: 'string' });
  b.control('WebView2', C + 'Control', { Source: ['string', ''], Html: ['string', ''], CanGoBack: ['bool', false, true],
    CanGoForward: ['bool', false, true] });
  b.method(C + 'WebView2', 'NavigateToString', ['string']); b.method(C + 'WebView2', 'GoBack'); b.method(C + 'WebView2', 'GoForward');
  b.method(C + 'WebView2', 'ExecuteScriptAsync', ['string'], b.task('string'));
  b.event(C + 'WebView2', 'NavigationStarting', { Uri: 'string', Cancel: ['bool', false] });
  b.event(C + 'WebView2', 'NavigationCompleted', { IsSuccess: 'bool', WebErrorStatus: 'string' });
  b.control('MediaPlayerElement', C + 'Control', { Source: ['string', ''], AutoPlay: ['bool', false],
    AreTransportControlsEnabled: ['bool', true], IsMuted: ['bool', false], Volume: ['double', 1],
    IsLoopingEnabled: ['bool', false], PlaybackRate: ['double', 1], Stretch: [M + 'Stretch', 2] });
  const player = 'Windows.Media.Playback.MediaPlayer', mediaSource = 'Windows.Media.Core.MediaSource';
  b.type(mediaSource, X + 'DependencyObject', 'object', []);
  b.property(mediaSource, 'Uri', 'string', '', true);
  b.method(mediaSource, 'CreateFromUri', ['string'], mediaSource, { isStatic: true });
  b.type(player);
  b.props(player, { Source: mediaSource, AutoPlay: ['bool', false], Volume: ['double', 1], IsMuted: ['bool', false],
    IsLoopingEnabled: ['bool', false], PlaybackRate: ['double', 1] });
  b.method(player, 'Play');
  b.method(player, 'Pause');
  b.method(player, 'PlayAsync', [], b.task('bool'));
  b.method(player, 'Seek', ['double']);
  b.events(player, ['MediaOpened', 'MediaEnded', 'MediaFailed', 'PlaybackStateChanged', 'PositionChanged']);
  b.props(C + 'MediaPlayerElement', { MediaPlayer: [player, null, true], MediaSource: mediaSource, PosterSource: M + 'ImageSource' });
  b.method(C + 'MediaPlayerElement', 'SetMediaPlayer', [player]);
  b.control('MediaTransportControls', C + 'Control', { IsEnabled: ['bool', true] });
  b.property(C + 'MediaPlayerElement', 'TransportControls', C + 'MediaTransportControls');
  b.method(C + 'MediaPlayerElement', 'PlayAsync', [], b.task('bool')); b.method(C + 'MediaPlayerElement', 'Pause');
  b.method(C + 'MediaPlayerElement', 'Seek', ['double']);
  b.events(C + 'MediaPlayerElement', ['MediaOpened', 'MediaEnded', 'MediaFailed', 'PlaybackStateChanged', 'PositionChanged']);
  for (const name of ['MapControl', 'InkCanvas', 'CaptureElement', 'AnimatedVisualPlayer', 'AnimatedIcon']) {
    b.control(name, C + 'Control', { Source: 'object' });
    b.event(C + name, 'PlatformUnavailable', { Code: 'string', Message: 'string' });
  }
  b.props(C + 'AnimatedVisualPlayer', { FallbackContent: 'object', AutoPlay: ['bool', true], IsPlaying: ['bool', false, true] });
  b.property(C + 'AnimatedIcon', 'FallbackIconSource', C + 'IconSource');
  b.control('InkToolbar', C + 'Control', { TargetInkCanvas: C + 'InkCanvas', InkColor: ['string', '#000000'], InkSize: ['double', 2] });
  b.props(C + 'InkCanvas', { InkColor: ['string', '#000000'], InkSize: ['double', 2] });
  b.events(C + 'InkCanvas', ['StrokesCollected', 'StrokesErased']); b.method(C + 'InkCanvas', 'Clear');
  b.method(C + 'AnimatedVisualPlayer', 'PlayAsync', ['double', 'double', 'bool'], b.task());
  b.method(C + 'AnimatedVisualPlayer', 'Pause'); b.method(C + 'AnimatedVisualPlayer', 'Resume');
}
