import {createAnimationSystem} from './animation-system.js';
import {applyControlStateFeedback} from '@sharpforge/winui-controls';
import {initializeJavaScriptServices, animationSourceAccess, createJavaScriptFrameScheduler} from './javascript/services.js';
import {createStyleSystem} from './style-system.js';
import {WinUIHost} from './host.js';
import {JavaScriptUIContext} from './javascript/context.js';
import {createFacadeTypes, installFacadeMembers} from './javascript/members.js';
import {createReleasedMethods} from './javascript/methods.js';
import {dispatchFacadeEvent, dispatchPrivateInput, updateFacadeLayout, completeFacadeRoute} from './javascript/events.js';
import {requestFacadeEvent} from './javascript/event-requests.js';

/** Create an application with the same registered UI service members as the managed runtime. */
export function createWinUIApp(root, options = {}) {
  const context = new JavaScriptUIContext(options);
  const scheduler = createJavaScriptFrameScheduler(root, options);
  context.frameScheduler = scheduler;
  const host = new WinUIHost(root, {
    ...options,
    scheduler,
    services: {...options.services, objectTree: context.objectTree,
      environment: context.services.environment ?? options.services?.environment},
    onEvent: (id, event, payload) => dispatchFacadeEvent(context, id, event, payload),
    onEventRequest: (id, event, payload, request) => requestFacadeEvent(context, id, event, payload, request),
    onControlStateChanged: changes => applyControlStateFeedback(context, changes),
    onRoutedEvent: (id, event, payload) => completeFacadeRoute(context, id, event, payload),
    onCollectionInput: (id, property, values) => context.collectionInput(context.reference(id), property, values),
    onRealizeItems: ({id, indices}) => context.realizeItemIndices(context.reference(id), indices),
    onPrivateInput: (id, property, value) => dispatchPrivateInput(context, id, property, value),
    onLayout: changes => updateFacadeLayout(context, changes)
  });
  context.host = host;
  const services = {
    objects: context.objects, classes: context.classes, host,
    send: command => context.send(command), value: value => context.value(value), options
  };
  context.styles = createStyleSystem({...services, context, animations: () => context.animations});
  context.propertyRegistry = context.styles.registry;
  initializeJavaScriptServices(context);
  if (typeof host.requestEvent !== 'function') {
    context.requestEvent = (receiver, event, payload, request) =>
      requestFacadeEvent(context, typeof receiver === 'string' ? receiver : context.id(receiver), event, payload, request);
  }
  context.animations = createAnimationSystem({...services, styles: context.styles, sourceAccess: animationSourceAccess(context)});
  context.releasedMethods = createReleasedMethods(context);
  createFacadeTypes(context);
  installFacadeMembers(context);
  return {
    ...context.namespaces, host,
    advanceAnimations: milliseconds => context.animations.advance(milliseconds),
    animationState: id => context.animations.clock.state(id?.$node?.id ?? id),
    flush: () => { context.flushContentPresenters(); host.flush(); },
    settled: () => { context.flushContentPresenters(); return host.settled(); },
    setRenderer: mode => host.setBackend(mode), dispose: () => context.dispose()
  };
}
