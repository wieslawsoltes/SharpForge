/** Logical SDK stages. CoreCompile is a host boundary, never a fabricated compiler task. */
export function installSdkBuildTargets(context) {
  const defaults = {
    builddependson: 'BeforeBuild;CoreBuild;AfterBuild',
    corebuilddependson: 'PrepareForBuild;ResolveReferences;PrepareResources;Compile',
    compiledependson: 'BeforeCompile;CoreCompile;AfterCompile',
  };
  for (const [name, value] of Object.entries(defaults)) context.properties[name] ??= value;
  const stages = {
    BeforeBuild: '', PrepareForBuild: '', ResolveReferences: '', PrepareResources: '', BeforeCompile: '',
    CoreCompile: '', AfterCompile: '', Compile: '$(CompileDependsOn)', CoreBuild: '$(CoreBuildDependsOn)',
    AfterBuild: '', Build: '$(BuildDependsOn)',
  };
  for (const [name, dependencies] of Object.entries(stages)) {
    const existing = context.targets.find(target => target.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (name === 'CoreCompile') existing.buildStage = 'compile';
      continue;
    }
    context.targets.push({name, file: context.path, attributes: {Name: name, DependsOnTargets: dependencies},
      tasks: [], nodes: [], start: 0, sdkStage: true, ...(name === 'CoreCompile' ? {buildStage: 'compile'} : {})});
  }
  context.targetAttributes.DefaultTargets ||= 'Build';
}
