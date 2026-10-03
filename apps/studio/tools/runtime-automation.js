export function contributeRuntimeAutomation(automation,context){

return automation.contributeAutomation('',{configureRuntime:patch=>context.runtimeTools.configure(patch),
getRuntimeSettings:()=>context.runtimeTools.settings()});
}
