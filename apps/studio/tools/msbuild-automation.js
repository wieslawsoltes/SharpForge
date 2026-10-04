/** Existing native automation remains stable; context/profile/testing operations compose the same visible controllers. */
export function contributeMsbuildAutomation(automation, context) {
  const build = context.nativeBuild;
  return automation.contributeAutomation('', {native: {
    connect: client => build.connect(client),
    attach: () => build.attach(),
    run: action => build.run(action),
    cancel: () => build.cancel(),
    open: path => build.open(path),
    save: () => build.save(),
    configure: settings => Object.assign(build.settings, settings),
    getState: () => build.snapshot(),
    contexts: {
      selectProject: project => build.contexts.setProject(project),
      load: () => build.contexts.load(),
      select: id => build.contexts.select(id),
      getState: () => build.contexts.snapshot()
    },
    profiles: {
      refresh: () => build.profiles.refresh(),
      selectLaunch: name => build.profiles.selectLaunch(name),
      selectPublish: name => build.profiles.selectPublish(name),
      run: () => build.runProject(),
      publish: () => build.publishProfile(),
      getState: () => build.profiles.snapshot()
    },
    testing: {
      configure: settings => build.tests.configure(settings),
      discover: () => build.tests.discover(),
      select: (id, included) => build.tests.select(id, included),
      selectAll: included => build.tests.selectAll(included),
      run: () => build.tests.run(),
      cancel: () => build.tests.cancel(),
      openSource: id => build.tests.openSource(id),
      getState: () => build.tests.snapshot()
    }
  }});
}
