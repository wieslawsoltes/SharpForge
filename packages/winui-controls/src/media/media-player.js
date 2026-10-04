import { ControlEvents, ControlError, registerFamily, stateFor } from '../policy/events.js';
import { HostPermissionPolicy } from '../policy/capabilities.js';

/** Playback state is independent of the DOM. A host explicitly supplies decoding/playback. */
export class MediaPlayerSession extends ControlEvents {
  constructor({ policy = new HostPermissionPolicy(), backend = null } = {}) {
    super();
    this.policy = policy;
    this.backend = backend;
    this.source = '';
    this.state = 'None';
    this.position = 0;
    this.duration = 0;
    this.volume = 1;
    this.muted = false;
    this.looping = false;
    this.rate = 1;
    this.generation = 0;
    this.playPromise = null;
    this.disposed = false;
  }
  setSource(uri) {
    const source = uri ? this.policy.url(uri, { capability: 'media' }) : '';
    if (source === this.source) return;
    this.generation++;
    this.backend?.pause?.();
    this.source = source;
    this.position = this.duration = 0;
    this.state = source ? 'Opening' : 'None';
    this.emit('SourceChanged', { Source: source });
  }
  play(options = {}) {
    if (this.playPromise) return this.playPromise;
    let resolveResult;
    let rejectResult;
    this.playPromise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const result = this.playPromise;
    this.#play(options).then(resolveResult, rejectResult);
    result.finally(() => { if (this.playPromise === result) this.playPromise = null; }).catch(() => {});
    return result;
  }
  async #play({ userInitiated = false, signal }) {
    signal?.throwIfAborted();
    if (this.disposed) throw new ControlError('SFUI16B7', 'Media player is disposed');
    if (!this.source) throw new ControlError('SFUI16B6', 'Media has no source');
    if (!this.backend?.play) throw new ControlError('SFUI16B7', 'Media playback requires a host decoder');
    const generation = this.generation;
    if (!userInitiated && !await this.policy.authorize('media-autoplay', { source: this.source }, { signal })) {
      if (generation === this.generation) this.update('Paused');
      return false;
    }
    if (generation !== this.generation) return false;
    try {
      const played = await this.backend.play();
      signal?.throwIfAborted();
      if (generation !== this.generation) return false;
      if (played === false) { this.update('Paused'); return false; }
      this.update('Playing');
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.update('Paused');
      this.emit('MediaFailed', { Code: error?.name === 'NotAllowedError' ? 'AutoplayDenied' : 'PlaybackFailed' });
      return false;
    }
  }
  pause() { this.generation++; this.backend?.pause?.(); this.update(this.source ? 'Paused' : 'None'); }
  seek(position) {
    if (!Number.isFinite(position)) throw new ControlError('SFUI16B8', 'Playback position must be finite');
    this.position = Math.max(0, this.duration > 0 ? Math.min(this.duration, position) : position);
    if (this.backend) this.backend.currentTime = this.position;
    this.emit('PositionChanged', { Position: this.position });
  }
  update(state) { if (this.state !== state) { this.state = state; this.emit('PlaybackStateChanged', { State: state }); } }
  snapshot() {
    if (this.playPromise) throw new ControlError('SFUI16B8', 'Pending media playback cannot be snapshotted');
    return { version: 1, source: this.source, position: this.position, duration: this.duration,
      volume: this.volume, muted: this.muted, looping: this.looping, rate: this.rate, state: this.state };
  }
  restore(value) {
    if (value?.version !== 1) throw new ControlError('SFUI16B8', 'Invalid media snapshot');
    this.generation++;
    this.backend?.pause?.();
    for (const key of ['source', 'position', 'duration', 'volume', 'muted', 'looping', 'rate']) this[key] = value[key];
    // A rewind never starts a physical device. A subsequent explicit Play resumes it.
    this.state = value.state === 'Playing' ? 'Paused' : value.state;
  }
  dispose() { this.disposed = true; this.generation++; this.backend?.pause?.(); this.backend = null; super.dispose(); }
}

function mediaState(context, node, element) {
  return stateFor(context, node, 'media', () => {
    const model = new MediaPlayerSession({ policy: context.services.permissions, backend: element });
    for (const event of ['MediaFailed', 'PlaybackStateChanged', 'PositionChanged']) {
      model.on(event, args => context.emit(node, event, args));
    }
    return model;
  });
}

function mediaSource(context, properties) {
  if (properties.MediaSource != null) {
    const source = properties.MediaSource?.$ref && context.nodes.get(properties.MediaSource.$ref);
    if (!source || source.type !== 'Windows.Media.Core.MediaSource' || typeof source.properties.Uri !== 'string' || !source.properties.Uri) {
      throw new ControlError('SFUI16B6', 'Only URI MediaSource objects are supported', { kind: 'UnsupportedMediaSource' });
    }
    return source.properties.Uri;
  }
  if (properties.Source != null && typeof properties.Source !== 'string') {
    throw new ControlError('SFUI16B6', 'Only URI media sources are supported', { kind: 'UnsupportedMediaSource' });
  }
  return properties.Source ?? '';
}

export function registerMediaPlayerRenderer(registry) {
  registerFamily(registry, ['MediaPlayerElement', 'MediaElement'], {
    create: context => context.document.createElement('video'),
    render(context, node, element) {
      const model = mediaState(context, node, element);
      const p = node.properties;
      let source;
      try { source = mediaSource(context, p); }
      catch (error) {
        element.removeAttribute('src');
        model.pause();
        model.update('Failed');
        context.emit(node, 'MediaFailed', { Code: error.details?.kind ?? error.code, Message: error.message });
        return;
      }
      if (source !== model.source) {
        try {
          model.setSource(source);
          if (model.source) element.src = model.source;
          else { element.removeAttribute('src'); element.load?.(); }
        } catch (error) {
          element.removeAttribute('src');
          model.update('Failed');
          context.emit(node, 'MediaFailed', { Code: error.code ?? 'UnsupportedMediaSource', Message: error.message });
        }
      }
      element.controls = p.AreTransportControlsEnabled !== false;
      element.muted = !!p.IsMuted;
      element.volume = Math.max(0, Math.min(1, p.Volume ?? 1));
      element.loop = !!p.IsLoopingEnabled;
      element.playbackRate = Math.max(0.1, Math.min(16, p.PlaybackRate ?? 1));
      element.playsInline = true;
      element.preload = p.AutoPlay ? 'auto' : 'metadata';
      element.style.objectFit = ['none', 'fill', 'contain', 'cover'][p.Stretch ?? 2];
      const poster = p.PosterSource?.$ref ? context.nodes.get(p.PosterSource.$ref)?.properties.UriSource : p.PosterSource;
      if (poster) {
        try { element.poster = model.policy.url(poster, { capability: 'image', image: true }); }
        catch (error) { element.removeAttribute('poster'); context.emit(node, 'MediaFailed', { Code: error.code }); }
      } else element.removeAttribute('poster');
      if (p.AutoPlay && model.state === 'Opening') void model.play();
    },
    invoke(context, node, element, name, args) {
      const model = mediaState(context, node, element);
      if (!model.source && node.properties.Source) {
        model.setSource(node.properties.Source);
        element.src = model.source;
      }
      if (name === 'Play') return model.play({ userInitiated: !!args?.[0] });
      if (name === 'Pause') { model.pause(); return true; }
      if (name === 'Seek') { model.seek(args[0]); return true; }
      return undefined;
    }, events: {
      loadedmetadata(context, node, element) {
        const model = mediaState(context, node, element);
        model.duration = Number.isFinite(element.duration) ? element.duration : 0;
        model.update('Paused');
        context.emit(node, 'MediaOpened', { NaturalDuration: model.duration });
        return true;
      },
      timeupdate(context, node, element) {
        mediaState(context, node, element).position = element.currentTime;
        context.emit(node, 'PositionChanged', { Position: element.currentTime });
        return true;
      },
      play(context, node, element) { mediaState(context, node, element).update('Playing'); return true; },
      pause(context, node, element) { mediaState(context, node, element).update('Paused'); return true; },
      ended(context, node, element) {
        mediaState(context, node, element).update('Stopped'); context.emit(node, 'MediaEnded', {}); return true;
      },
      error(context, node, element) {
        mediaState(context, node, element).update('Failed');
        context.emit(node, 'MediaFailed', { Code: 'DecodeOrNetworkFailure' }); return true;
      }
    }
  });
}
