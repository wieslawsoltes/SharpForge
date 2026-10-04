import { LazyTools, studioToolLoaders } from '../lazy-tools.js';
import { LazyFeature } from './feature.js';
import { designerConfiguration } from './designer-configuration.js';
import { nativeConfiguration } from './native-configuration.js';
import { designerFacade, assemblyFacade, disassemblyFacade, wizardFacade, NativeBuildFacade } from './facades.js';
import { observeVisibleFeatures } from './visible-panels.js';

/** Eager startup registers small facades. Each feature module and controller is created only on first activation. */
export function createStudioLazyFeatures(context, { modules = new LazyTools(studioToolLoaders) } = {}) {
  const features = new Map();
  const register = (id, title, create) => {
    const feature = new LazyFeature({ id, title, modules, create, onError: error => context.toast(error.message, 'error') });
    features.set(id, feature);
    return feature;
  };
  const designer = designerFacade(register('designer', 'Designer', module => new module.DesignerTools(designerConfiguration(context))));
  const assembly = assemblyFacade(register('assembly', 'Assembly Explorer', module => new module.AssemblyWorkbench({
    openFile: () => context.$('#assembly-file-input').click(), request: (method, params) => context.compiler.request(method, params),
    download: context.download, invoke: context.invokeAssembly, onStatus: message => context.toast(message, 'error')
  })));
  const disassembly = disassemblyFacade(register('disassembly', 'Disassembly', module => new module.DisassemblyTool({
    request: (method, params) => context.runtime.request(method, params), onError: error => context.toast(error.message, 'error'),
    onBreakpoints: breakpoints => { if (context.state.lastManagedLaunch) context.state.lastManagedLaunch.instructionBreakpoints = breakpoints; }
  })));
  const native = new NativeBuildFacade(register('msbuild', 'MSBuild', module => new module.MSBuildTools({
    ...nativeConfiguration(context), settings: native.settings, buffers: native.buffers
  })));
  const wizard = wizardFacade(register('wizard', 'Project Wizard', module => new module.ProjectWizard({
    lockModal: busy => { context.state.modalBusy = busy; }, context: context.explorerContext,
    showModal: context.showModal, closeModal: context.closeModal, detachModalClose: () => { context.state.modalClose = null; },
    ask: context.ask, commitPlan: context.commitWizardPlan
  })));
  context.commands.configure('designer', { execute: async () => {
    await designer.ensure();
    context.docking.reset('designer');
    context.state.panel = 'designer';
    context.renderPanel('designer');
  } });
  const stopObserving = observeVisibleFeatures(context.docking, { designer, assembly, disassembly, native,
    debugSnapshot: () => context.state.debug ? { ...context.state.debug, selectedFrameId: context.state.frameId } : null });
  return { designer, assembly, disassembly, native, wizard,
    peek: id => features.get(id)?.peek() ?? null,
    dispose() { stopObserving(); for (const feature of features.values()) feature.dispose(); modules.dispose(); } };
}
