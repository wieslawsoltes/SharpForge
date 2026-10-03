import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'project-system:project-load', order: 370, async run(context) {
    const {source} = context;
    const {ProjectSystem,createCsproj}=await import('@sharpforge/project-system');
    const project=new ProjectSystem([{path:'Demo.csproj',text:createCsproj({outputType:'Exe',files:['Program.cs']})},{path:'Program.cs',text:source}]);
    const loaded=project.load('Demo.csproj');
    assert.equal(loaded.projects.length,1);
    assert.equal(project.compilationFiles('Demo.csproj').length,1);
    Object.assign(context, {ProjectSystem, project});
  }},
  {id: 'project-system:overflow-options', order: 1030, async run(context) {
    const {project} = context;
    assert.equal(typeof project.compilationOptions('Demo.csproj').checkOverflow,'boolean');
  }},
  {id: 'project-system:solution-membership', order: 1170, async run(context) {
    const {addSolutionProject,parseXml,editProjectMembership,buildSolutionTree}=await import('@sharpforge/project-system');
    const added=addSolutionProject('<Solution><Folder Name="/src/" /></Solution>',{solutionPath:'A.slnx',projectPath:'App/App.csproj',folder:'src'});
    assert.equal(parseXml(added).children.length,1);
    assert.equal(buildSolutionTree({files:[{path:'A.cs'}]}).length,1);
  }},
  {id: 'project-system:restored-solution', order: 1740, async run(context) {
    const {compileToIL, CilVirtualMachine, ProjectSystem, importWorkspaceZip, zip} = context;
    const restored=importWorkspaceZip(zip),loadedSystem=new ProjectSystem(restored.records);
    loadedSystem.load(restored.settings.entry);
    const generatedApp=compileToIL(loadedSystem.compilationFiles(restored.settings.startup));
    assert(generatedApp.success);
    assert.equal(new CilVirtualMachine(generatedApp.assembly).run().output,'42\n');
  }},
];
