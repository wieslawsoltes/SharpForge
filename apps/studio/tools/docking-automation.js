export function contributeDockingAutomation(automation,context){

return automation.contributeAutomation('',{getState:()=>({name:context.state.name,nativeMode:context.state.nativeMode,project:context.state.projectSnapshot,startupProject:context.state.startupProject,layout:context.docking.layout.snapshot(),files:context.state.files.map(f=>({...f})),active:context.state.active,diagnostics:context.state.result?.diagnostics??[],metrics:context.state.result?.metrics??null,debug:context.state.debug,panel:context.state.panel,artifact:context.state.assembly?{format:'ECMA-335',bytes:context.state.assembly.length,imported:context.state.importedAssembly}:null}),
getLayout:()=>context.docking.layout.snapshot(),
restoreLayout:value=>context.docking.layout.restore(value),
dockPanel:(id,group,side)=>context.docking.layout.dock(id,group,side),
floatPanel:id=>context.docking.layout.float(id),
autoHidePanel:(id,side)=>context.docking.layout.autoHide(id,side),
popoutPanel:id=>context.docking.host.popout(id),
returnPopout:id=>context.docking.host.returnPopout(id)});
}
