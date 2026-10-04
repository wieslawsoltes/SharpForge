import { validateOutputProperties, validateBuildArguments } from './argument-policy.js';
/** Pure browser/Node contracts. These validate transport, not the safety of a trusted build. */
export const MSBUILD_PROTOCOL_VERSION = 1;
export const BUILD_ACTIONS = Object.freeze(['build','rebuild','clean','restore','pack','publish','test','target','evaluate','preprocess','targets']);
export const EVALUATION_PROPERTIES = Object.freeze(['MSBuildVersion','MSBuildProjectFullPath','MSBuildAllProjects','Configuration','Platform','TargetFramework','TargetFrameworks','RuntimeIdentifier','RuntimeIdentifiers','AssemblyName','OutputType','TargetPath','OutputPath','IntermediateOutputPath','DefineConstants','LangVersion','Nullable','ImplicitUsings','CheckForOverflowUnderflow','IsPackable','PackageId','PackageVersion','RestoreSources','ManagePackageVersionsCentrally','Configurations','Platforms']);
export const EVALUATION_ITEMS = Object.freeze(['Compile','ProjectReference','PackageReference','PackageVersion','Reference','FrameworkReference','Analyzer','AdditionalFiles','EmbeddedResource','Content','None']);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function text(value,name,max=8192){if(typeof value!=='string'||value.length>max||/[\0\r\n]/.test(value))throw new Error(`Invalid ${name}`);return value;}
export function workspacePath(value){
 text(value,'workspace path',2048);const path=value.replaceAll('\\','/');
 if(!path||path.startsWith('/')||/[:\0]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||path.startsWith('-'))throw new Error('Expected a workspace-relative path without traversal');
 return path;
}
export function escapeMSBuild(value){return String(value).replace(/[%$@();,'"?*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0'));}
export function parsePropertyLines(source){
 const result=Object.create(null);if(typeof source!=='string'||source.length>65536)throw new Error('Properties exceed the text limit');
 for(const line of source.split(/\r?\n/)){if(!line.trim()||line.trimStart().startsWith('#'))continue;const at=line.indexOf('=');if(at<=0)throw new Error('Properties use one Name=Value per line');const name=line.slice(0,at).trim();if(!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name))throw new Error('Invalid MSBuild property name: '+name);result[name]=line.slice(at+1);}
 return result;
}
function names(values,name,max=256){if(!Array.isArray(values)||values.length>max)throw new Error(`Invalid ${name}`);return [...new Set(values.map(v=>{text(v,name,256);if(!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(v))throw new Error(`Invalid ${name}: ${v}`);return v;}))];}
export function normalizeBuildRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected a build request');
 const action=input.action??'build';if(!BUILD_ACTIONS.includes(action))throw new Error('Unknown MSBuild action');
 const project=workspacePath(input.project);if(!/\.(?:[a-z]*proj|slnx|sln)$/i.test(project))throw new Error('Choose a project, .slnx or .sln');
 const properties=Object.create(null),source=input.properties??{};if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length>256)throw new Error('Invalid properties');
 for(const [key,value]of Object.entries(source)){if(!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key))throw new Error('Invalid property name: '+key);properties[key]=text(String(value),'property value');}
 for(const [key,prop]of [['configuration','Configuration'],['platform','Platform'],['framework','TargetFramework'],['runtime','RuntimeIdentifier']])if(input[key]){for(const name of Object.keys(properties))if(name.toLowerCase()===prop.toLowerCase())delete properties[name];properties[prop]=text(input[key],key,256);}
 const seen=new Set();for(const name of Object.keys(properties)){const key=name.toLowerCase();if(seen.has(key))throw new Error('Duplicate case-insensitive property: '+name);seen.add(key);}
 const targets=names(input.targets??[],'target');if(action==='target'&&!targets.length)throw new Error('A custom target is required');
 const propertyNames=names(input.propertyNames??EVALUATION_PROPERTIES,'property query'),itemNames=names(input.itemNames??EVALUATION_ITEMS,'item query');
 const resultTargets=names(input.resultTargets??[],'target result');
 const verbosity=input.verbosity??'minimal';if(!['quiet','minimal','normal','detailed','diagnostic'].includes(verbosity))throw new Error('Invalid verbosity');
 const maxNodes=input.maxNodes??1;if(!Number.isInteger(maxNodes)||maxNodes<1||maxNodes>64)throw new Error('Parallel nodes must be 1–64');
 const args=input.arguments??[];if(!Array.isArray(args)||args.length>128)throw new Error('Invalid additional arguments');
 // Advanced switches run with the same explicit local trust as custom tasks. They are not a sandbox.
 const extraArguments=args.map(a=>text(a,'MSBuild argument',8192));
 for(const a of extraArguments){if(a.startsWith('@')){workspacePath(a.slice(1));if(!/\.rsp$/i.test(a))throw new Error('Response file must have .rsp extension');}else if(!a.startsWith('-')&&!a.startsWith('/'))throw new Error('Additional arguments must be individual MSBuild switches or @workspace.rsp');}
 validateOutputProperties(properties);validateBuildArguments(extraArguments,{elevated:input.elevated===true});
 for(const key of ['trusted','restore','binaryLog','graphBuild','designTime','nodeReuse','compilerServer','sarif','elevated'])if(own(input,key)&&typeof input[key]!=='boolean')throw new Error(`Invalid ${key}`);
 return {action,project,properties,targets,propertyNames,itemNames,resultTargets,verbosity,maxNodes,arguments:extraArguments,trusted:input.trusted===true,restore:input.restore===true,binaryLog:input.binaryLog===true,graphBuild:input.graphBuild===true,designTime:input.designTime===true,nodeReuse:input.nodeReuse===true,compilerServer:input.compilerServer===true,sarif:input.sarif===true,elevated:input.elevated===true};
}
export { parseDiagnosticLine } from './diagnostics.js';
/** MSBuild can prefix JSON with SDK banners/build output; parse a complete terminal JSON object. */
export function parseEvaluationOutput(output){
 const text=String(output).replace(/^\uFEFF/,'').trim();if(text.length>32*1024*1024)throw new Error('Evaluation output limit exceeded');
 const starts=[];for(let i=0;i<text.length;i++)if(text[i]==='{'&&(i===0||text[i-1]==='\n'))starts.push(i);
 for(let i=starts.length-1;i>=0;i--){try{const value=JSON.parse(text.slice(starts[i]));if(value&&typeof value==='object'&&!Array.isArray(value)&&['Properties','Items','TargetResults'].some(k=>own(value,k)))return value;}catch{/* A log line is not the result. */}}
 throw new Error('MSBuild did not return query JSON. Property/item queries require MSBuild 17.8 or later; inspect the build output.');
}
