export function contributeMsbuildAutomation(automation,context){

return automation.contributeAutomation('',{native:{connect:client=>context.nativeBuild.connect(client),attach:()=>context.nativeBuild.attach(),run:action=>context.nativeBuild.run(action),cancel:()=>context.nativeBuild.cancel(),open:path=>context.nativeBuild.open(path),save:()=>context.nativeBuild.save(),configure:settings=>Object.assign(context.nativeBuild.settings,settings),getState:()=>context.nativeBuild.snapshot()}});
}
