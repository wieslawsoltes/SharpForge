/** Called by the consolidated real-browser A16 suite after the complete implementation/build. */
async function runA16FamilyMediaFixture() {
  const require = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = (element, events, predicate, label) => new Promise((resolve, reject) => {
    if (predicate()) { resolve(); return; }
    const finish = error => {
      clearTimeout(timer);
      for (const name of events) element.removeEventListener(name, check);
      element.removeEventListener('error', failed);
      if (error) reject(error); else resolve();
    };
    const check = () => { if (predicate()) finish(); };
    const failed = () => finish(new Error('Native media error ' + element.error?.code + ' while ' + label));
    const timer = setTimeout(() => finish(new Error('Timed out while ' + label)), 15_000);
    for (const name of events) element.addEventListener(name, check);
    element.addEventListener('error', failed);
  });
  const scene = { version: 1, windows: ['media-window'], nodes: [
    { id: 'media-window', type: 'Microsoft.UI.Xaml.Window', properties: { Content: { $ref: 'media' } }, collections: {}, events: [] },
    { id: 'media', type: 'Microsoft.UI.Xaml.Controls.MediaPlayerElement', properties: { Name: 'Media playback fixture',
      Width: 320, Height: 200, Source: '', IsMuted: true, AutoPlay: false, AreTransportControlsEnabled: true }, collections: {}, events: [] }
  ] };
  await a16.mount(scene, { key: 'media', width: 340, height: 220 });
  const record = a16.records.get('media');
  const host = record.host;
  const media = host.nodes.get('media');
  const video = host.elements.get('media');
  record.services.permissions.origins.add(location.origin);
  const decoder = video.canPlayType('video/mp4; codecs="avc1.42E01E"');
  const result = { fixture: 'tests/fixtures/a16/transport.mp4', decoder, nativeControls: video.controls };
  require(video.tagName === 'VIDEO' && video.controls, 'MediaPlayerElement must expose actual native transport controls');
  if (decoder) {
    media.properties.Source = new URL('/tests/fixtures/a16/transport.mp4', location.href).href;
    host.invalidate('media');
    await host.settled();
    await waitFor(video, ['loadedmetadata'], () => video.readyState >= 1, 'loading the MP4 fixture');
    require(video.duration >= 1.9 && video.duration <= 2.1, 'The synthetic MP4 duration was not decoded');
    const played = await host.invoke('media', 'Play', [true]);
    require(played, 'The granted muted playback request failed');
    await waitFor(video, ['timeupdate', 'playing'], () => video.currentTime > 0.01, 'advancing native playback');
    host.invoke('media', 'Pause', []);
    require(video.paused, 'Pause did not stop the native media element');
    host.invoke('media', 'Seek', [0.75]);
    await waitFor(video, ['seeked', 'timeupdate'], () => !video.seeking && Math.abs(video.currentTime - 0.75) < 0.12, 'seeking native media');
    result.transport = { status: 'passed', duration: video.duration, position: video.currentTime, paused: video.paused,
      events: record.events.filter(value => ['MediaOpened', 'PlaybackStateChanged', 'PositionChanged'].includes(value.name)).map(value => value.name) };
  } else result.transport = { status: 'unsupported', reason: 'This browser/platform does not expose an H.264 decoder.' };
  host.nodes.set('unsupported-source', { id: 'unsupported-source', type: 'Windows.Media.Core.MediaStreamSource',
    properties: {}, collections: {}, events: [] });
  media.properties.MediaSource = { $ref: 'unsupported-source' };
  host.invalidate('media');
  await host.settled();
  const failure = record.events.findLast(value => value.name === 'MediaFailed');
  require(failure?.payload.Code === 'UnsupportedMediaSource', 'Unsupported source kind did not raise MediaFailed');
  result.unsupportedSource = failure.payload.Code;
  require(!a16.errors.length, 'Media fixture emitted host faults: ' + JSON.stringify(a16.errors));
  return result;
}
