import {DesignerAuthoringError, DesignerStateTransition, designerBrushCss, designerPreviewDecorations} from '../../packages/designer/src/index.js';

/** One surface preview owns its clock and stops before a document, revision or preview owner changes. */
export class DesignerStatePlayback {
  constructor(view) {
    this.view = view;
    this.frame = null;
    this.session = null;
    this.baseScene = null;
    this.previewDocument = null;
    this.revision = null;
  }

  remember(baseScene) {
    this.stop();
    this.baseScene = baseScene;
    this.previewDocument = this.view.document;
    this.revision = this.view.document.revision;
  }

  present(scene) {
    this.view.host.load(scene);
    this.view.host.flush();
    this.decorate(designerPreviewDecorations(scene));
    this.view.drawAdorners();
  }

  decorate(decorations) {
    for (const decoration of decorations) {
      const element = this.view.host.elements.get(decoration.id);
      if (element) element.style[decoration.property] = decoration.value;
    }
  }

  show(baseScene, scene) {
    this.remember(baseScene);
    this.present(scene);
  }

  play(baseScene, fromScene, toScene, options) {
    const session = new DesignerStateTransition(fromScene, toScene, options);
    const clock = this.view.host.document.defaultView;
    if (typeof clock.requestAnimationFrame !== 'function' || typeof clock.cancelAnimationFrame !== 'function') {
      session.dispose();
      throw new DesignerAuthoringError('SFD1855', 'Timed preview requires an animation-frame clock.');
    }
    this.remember(baseScene);
    this.clock = clock;
    this.session = session;
    this.present(session.initialScene);
    const decorations = new Map(designerPreviewDecorations(fromScene).map(item => [item.id + ':' + item.property, item]));
    let start = null;
    const tick = timestamp => {
      this.frame = null;
      if (this.previewDocument !== this.view.document || this.revision !== this.view.document.revision || this.view.host.disposed) {
        this.stop(false);
        return;
      }
      try {
        start ??= timestamp;
        const elapsed = timestamp - start;
        const commands = session.commandsAt(elapsed);
        this.view.host.apply(commands);
        this.view.host.flush();
        for (const command of commands) {
          if (!['Background', 'Fill'].includes(command.property)) continue;
          const key = command.id + ':background';
          if (command.value?.GradientStops) {
            decorations.set(key, {id: command.id, property: 'background', value: designerBrushCss(command.value)});
          } else decorations.delete(key);
        }
        this.decorate(decorations.values());
        this.view.drawAdorners();
        if (elapsed < session.duration) this.frame = clock.requestAnimationFrame(tick);
        else { session.dispose(); this.session = null; }
      } catch (error) {
        this.stop();
        this.view.error(error);
      }
    };
    this.frame = clock.requestAnimationFrame(tick);
  }

  stop(restore = true) {
    if (this.frame !== null) this.clock.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.session?.dispose();
    this.session = null;
    const base = this.baseScene;
    this.baseScene = null;
    if (restore && base && this.previewDocument === this.view.document && this.revision === this.view.document.revision && !this.view.host.disposed) {
      this.present(base);
    }
    this.previewDocument = null;
  }

  dispose() { this.stop(false); }
}
