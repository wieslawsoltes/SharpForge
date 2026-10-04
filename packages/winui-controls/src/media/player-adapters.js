import { MediaPlayerSession } from './media-player.js';
import { registerMethod, registerGet, registerSet, read, invokeHost, unsupported, CONTROLS as C } from '../policy/adapter-helpers.js';

const playerType = 'Windows.Media.Playback.MediaPlayer';
const sourceType = 'Windows.Media.Core.MediaSource';

function ownership(context, receiver) {
  return context.state(receiver, 'family.mediaOwner', () => ({ owner: null,
    snapshot() { return { version: 1, owner: this.owner }; },
    restore(value) { this.owner = value.owner; },
    *retainedValues() { yield this.owner; } }));
}

function host(context, receiver, method, args = []) {
  const owner = ownership(context, receiver).owner;
  if (!owner) return unsupported('MediaPlayer playback without an attached MediaPlayerElement');
  return invokeHost(context, owner, method, args);
}

export function managedMediaPlayer(context, receiver) {
  return context.state(receiver, 'family.mediaPlayer', () => {
    const model = new MediaPlayerSession({ policy: context.services.permissions,
      backend: { play: () => host(context, receiver, 'Play', [true]), pause: () => {
        if (ownership(context, receiver).owner) host(context, receiver, 'Pause');
      } } });
    for (const name of ['MediaFailed', 'PlaybackStateChanged', 'PositionChanged']) {
      model.on(name, args => context.emit(receiver, name, args));
    }
    return model;
  });
}

function publishPlayer(context, receiver) {
  const owner = ownership(context, receiver).owner;
  if (!owner) return;
  const source = context.read(receiver, 'Source');
  context.write(owner, 'MediaSource', source);
  context.write(owner, 'Source', source && context.native(source) ? read(context, source, 'Uri', '') : '');
  for (const name of ['AutoPlay', 'Volume', 'IsMuted', 'IsLoopingEnabled', 'PlaybackRate']) {
    context.write(owner, name, context.read(receiver, name));
  }
}

export function registerPlayerAdapters(registry) {
  registerMethod(registry, sourceType, 'CreateFromUri', (context, receiver, args) => {
    const uri = context.services.permissions.url(String(context.native(args[0])), { capability: 'media' });
    return context.allocate(sourceType, { Uri: uri });
  });
  registerMethod(registry, C + 'MediaPlayerElement', 'SetMediaPlayer', (context, receiver, args) => {
    const previous = context.read(receiver, 'MediaPlayer');
    if (context.native(previous)) ownership(context, previous).owner = null;
    context.write(receiver, 'MediaPlayer', args[0]);
    if (!context.native(args[0])) { context.write(receiver, 'Source', ''); context.write(receiver, 'MediaSource', null); return; }
    ownership(context, args[0]).owner = receiver;
    publishPlayer(context, args[0]);
  });
  registerGet(registry, C + 'MediaPlayerElement', 'MediaPlayer', (context, receiver) => {
    const value = context.read(receiver, 'MediaPlayer');
    return context.native(value) ? value : null;
  });
  registerSet(registry, playerType, 'Source', (context, receiver, value) => {
    if (context.native(value) && (context.typeOf(value) !== sourceType || !read(context, value, 'Uri', ''))) {
      context.emit(receiver, 'MediaFailed', { Code: 'UnsupportedMediaSource' });
      return;
    }
    const source = context.native(value) ? read(context, value, 'Uri', '') : '';
    managedMediaPlayer(context, receiver).setSource(source);
    context.write(receiver, 'Source', value);
    publishPlayer(context, receiver);
  });
  for (const name of ['AutoPlay', 'Volume', 'IsMuted', 'IsLoopingEnabled', 'PlaybackRate']) {
    registerSet(registry, playerType, name, (context, receiver, value) => {
      const native = context.native(value);
      if ((name === 'Volume' || name === 'PlaybackRate') && (!Number.isFinite(native)
        || native < (name === 'Volume' ? 0 : 0.1) || native > (name === 'Volume' ? 1 : 16))) {
        throw new RangeError('Media playback value is outside its supported range');
      }
      context.write(receiver, name, value);
      publishPlayer(context, receiver);
    });
  }
  registerMethod(registry, playerType, 'PlayAsync', (context, receiver) =>
    context.task(managedMediaPlayer(context, receiver).play(), { resultType: 'bool' }));
  registerMethod(registry, playerType, 'Play', (context, receiver) => {
    const result = managedMediaPlayer(context, receiver).play();
    context.task(result, { resultType: 'bool' });
  });
  registerMethod(registry, playerType, 'Pause', (context, receiver) => managedMediaPlayer(context, receiver).pause());
  registerMethod(registry, playerType, 'Seek', (context, receiver, args) => {
    const model = managedMediaPlayer(context, receiver);
    model.seek(Number(context.native(args[0])));
    host(context, receiver, 'Seek', [model.position]);
  });
}

export function applyMediaInput(context, receiver, type, event, payload) {
  if (!['MediaPlayerElement', 'MediaElement'].includes(type)) return false;
  const player = context.read(receiver, 'MediaPlayer');
  if (!context.native(player)) return false;
  const model = managedMediaPlayer(context, player);
  if (event === 'MediaOpened') model.duration = Math.max(0, Number(payload.NaturalDuration) || 0);
  else if (event === 'PositionChanged') model.position = Math.max(0, Number(payload.Position) || 0);
  else if (event === 'PlaybackStateChanged') model.state = payload.State;
  else if (event === 'MediaFailed') model.state = 'Failed';
  else return false;
  context.emit(player, event, payload);
  return true;
}
