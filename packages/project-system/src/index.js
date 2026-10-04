import {readLegacySolution} from './legacy-solution.js';
export * from './legacy-solution.js';
import { parseXml, xmlEscape } from './xml.js';
export * from './xml.js';
export * from './disk.js';

import { normalizePath, directoryName, baseName } from './paths.js';
export * from './paths.js';
const splitList=value=>String(value??'').split(';').map(s=>s.trim()).filter(Boolean);
const regexCache=new Map();
export function matchesGlob(path,pattern){
  let regex=regexCache.get(pattern);
  if(!regex){let out='^';for(let i=0;i<pattern.length;i++){const c=pattern[i];if(c==='*'&&pattern[i+1]==='*'){i++;if(pattern[i+1]==='/'){i++;out+='(?:.*/)?';}else out+='.*';}else if(c==='*')out+='[^/]*';else if(c==='?')out+='[^/]';else out+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}regex=new RegExp(out+'$');if(regexCache.size>2048)regexCache.clear();regexCache.set(pattern,regex);}
  return regex.test(path);
}

import { evaluateCondition } from './conditions.js';
export { evaluateCondition } from './conditions.js';

export class ProjectSystem {
  constructor(files,{configuration='Debug',platform='AnyCPU',targetFramework='',properties={},maxFiles=5000}={}){
    this.files=new Map();this.projects=new Map();this.diagnostics=[];this.configuration=configuration;this.platform=platform;this.targetFramework=targetFramework;this.globalProperties=Object.fromEntries(Object.entries(properties).map(([k,v])=>[k.toLowerCase(),String(v)]));
    const input=files instanceof Map?[...files].map(([path,v])=>typeof v==='string'?{path,text:v}:{...v,path}):files;
    if(!Array.isArray(input)||input.length>maxFiles)throw new Error('Workspace file limit exceeded');
    for(const f of input){const path=normalizePath(f.path??f.uri);if(this.files.has(path))throw new Error(`Duplicate workspace path: ${path}`);if(typeof f.text!=='string'&&!(f.bytes instanceof Uint8Array))throw new Error(`No file contents: ${path}`);this.files.set(path,{...f,path});}
  }
  diagnostic(path,message,severity='warning',code='SFP1001'){const d={path,message,severity,code};if(!this.diagnostics.some(x=>x.path===path&&x.message===message))this.diagnostics.push(d);return d;}
  text(path){const file=this.files.get(path);if(!file||typeof file.text!=='string')throw new Error(`Missing text file '${path}'. Open its containing folder to grant access to sibling files.`);return file.text;}
  load(entry){
    entry=normalizePath(entry);this.projects.clear();this.diagnostics=[];let solution={path:entry,name:baseName(entry).replace(/\.(slnx|csproj)$/i,''),folders:[],items:[],projectPaths:[]};
    if(/\.sln$/i.test(entry)){solution=readLegacySolution(this.text(entry),entry);this.diagnostics.push(...solution.diagnostics);delete solution.diagnostics;}else if(/\.slnx$/i.test(entry)){
      const xml=parseXml(this.text(entry));if(xml.name!=='Solution')throw new Error('Expected <Solution> root');
      const visit=(node,folder='')=>{for(const child of node.children){const a=child.attributes;try{
        if(child.name==='Folder'){const name=a.Name??'';if(!name)throw new Error('Solution Folder requires Name');const next=name.startsWith('/')?name:(folder+'/'+name).replace(/\/+/g,'/');solution.folders.push(next);visit(child,next);}
        else if(child.name==='Project'){const path=normalizePath(a.Path??'',directoryName(entry));solution.projectPaths.push(path);solution.items.push({kind:'project',path,folder});for(const option of child.children)this.diagnostic(entry,`Solution project option '${option.name}' is retained for inspection, not evaluated.`);}
        else if(child.name==='File'){solution.items.push({kind:'file',path:normalizePath(a.Path??'',directoryName(entry)),folder});}
        else this.diagnostic(entry,`Solution element '${child.name}' is not evaluated.`);
      }catch(e){this.diagnostic(entry,e.message,'error');}}};visit(xml);
    }else if(/\.csproj$/i.test(entry))solution.projectPaths=[entry];else throw new Error('Select a .csproj, .slnx or .sln file');
    const visiting=new Set(),ordered=[];
    const loadProject=(path,chain=[])=>{
      if(visiting.has(path)){this.diagnostic(path,'ProjectReference cycle: '+[...chain,path].join(' → '),'error','SFP1002');return;}
      if(this.projects.has(path))return;if(this.projects.size>=100){this.diagnostic(path,'Project limit (100) exceeded','error');return;}
      visiting.add(path);let project;
      try{project=this.evaluateProject(path);this.projects.set(path,project);for(const ref of project.projectReferences)loadProject(ref.path,[...chain,path]);ordered.push(path);}catch(e){this.diagnostic(path,e.message,'error');}
      visiting.delete(path);
    };
    for(const path of new Set(solution.projectPaths))loadProject(path);
    this.solution={...solution,projectPaths:[...new Set(solution.projectPaths)],buildOrder:ordered};
    return this.snapshot();
  }
  evaluateProject(path){
    const xml=parseXml(this.text(path));if(xml.name!=='Project')throw new Error(`Expected <Project> in ${path}`);
    const base=directoryName(path),props=Object.create(null),global=new Set(['configuration','platform','msbuildprojectdirectory','msbuildprojectname','msbuildprojectfullpath']);
    Object.assign(props,{configuration:this.configuration,platform:this.platform,msbuildprojectdirectory:'/'+base,msbuildprojectname:baseName(path).replace(/\.csproj$/i,''),msbuildprojectfullpath:'/'+path});
    for(const [key,value]of Object.entries(this.globalProperties)){if(!key.startsWith('msbuild')){props[key]=value;global.add(key);}}
    if(this.targetFramework){props.targetframework=this.targetFramework;global.add('targetframework');}
    const sdk=xml.attributes.Sdk??xml.children.find(c=>c.name==='Sdk')?.attributes.Name??'';
    const expand=value=>String(value??'').replace(/\$\(([^)]+)\)/g,(_,key)=>{const k=key.toLowerCase();if(k.startsWith('[')){this.diagnostic(path,'MSBuild property functions are not executed.','error');return '';}return props[k]??'';});
    const resolveAt=(value,dir=base)=>{const result=expand(value);return result.startsWith('/')&&String(value).includes('$(')?normalizePath(result.slice(1)):normalizePath(result,dir);};
    const resolve=value=>resolveAt(value);
    const enabled=node=>{try{return evaluateCondition(node.attributes.Condition,{properties:props,exists:p=>{try{if(p==='/'||p==='.')return true;return this.files.has(p.startsWith('/')?normalizePath(p.slice(1)):normalizePath(p,base))||[...this.files.keys()].some(f=>f.startsWith((p.startsWith('/')?normalizePath(p.slice(1)):normalizePath(p,base))+'/'));}catch{return false;}}});}catch(e){this.diagnostic(path,e.message+'; the conditioned item/group was skipped.','error','SFP1003');return false;}};
    const inherited=(name)=>{let dir=base;for(;;){const candidate=dir?dir+'/'+name:name;if(this.files.has(candidate))return candidate;if(!dir)break;dir=directoryName(dir);}return null;};
    const before=inherited('Directory.Build.props'),after=inherited('Directory.Build.targets');
    const itemGroups=[],definitionGroups=[],imports=[],targets=[],usingTasks=[],visited=new Set();
    let currentFile=path;
    const withFile=(file,action)=>{const saved=currentFile,keys=['msbuildthisfiledirectory','msbuildthisfilefullpath','msbuildthisfilename','msbuildthisfileextension'],old=keys.map(k=>props[k]);currentFile=file;const directory=directoryName(file),name=baseName(file),at=name.lastIndexOf('.');Object.assign(props,{msbuildthisfiledirectory:'/'+(directory?directory+'/':''),msbuildthisfilefullpath:'/'+file,msbuildthisfilename:at<0?name:name.slice(0,at),msbuildthisfileextension:at<0?'':name.slice(at)});try{return action();}finally{currentFile=saved;keys.forEach((k,i)=>{if(old[i]===undefined)delete props[k];else props[k]=old[i];});}};
    const visit=(file,root,depth=0)=>{
      if(depth>64)throw new Error('Project import nesting limit exceeded');if(visited.has(file)){this.diagnostic(path,`Duplicate or circular import '${file}' was skipped.`,'warning','SFP1201');return;}if(visited.size>=256)throw new Error('Project import file limit exceeded');visited.add(file);imports.push(file);
      if(root.name!=='Project')throw new Error(`Expected <Project> in import '${file}'`);
      withFile(file,()=>walk(root.children,depth));
    };
    const walk=(children,depth)=>{for(const child of children){
      // Item/definition conditions are evaluated in the later item pass, with final properties.
      if(child.name==='ItemGroup'){itemGroups.push({node:child,file:currentFile});continue;}
      if(child.name==='ItemDefinitionGroup'){definitionGroups.push({node:child,file:currentFile});continue;}
      if(!enabled(child))continue;
      if(child.name==='PropertyGroup')for(const p of child.children){if(!enabled(p))continue;const name=p.name.toLowerCase();if(!global.has(name)&&!name.startsWith('msbuildthisfile'))props[name]=expand(p.text.trim());}
      else if(child.name==='ImportGroup')walk(child.children,depth);
      else if(child.name==='Import'){
        if(child.attributes.Sdk){this.diagnostic(path,'Explicit SDK imports require native MSBuild.','error','SFP1004');continue;}
        try{const raw=expand(child.attributes.Project);if(!raw)throw new Error('Import requires a Project path');const pattern=raw.startsWith('/')&&String(child.attributes.Project).includes('$(')?normalizePath(raw.slice(1)):normalizePath(raw,directoryName(currentFile));const files=/[*?]/.test(pattern)?[...this.files.keys()].filter(f=>matchesGlob(f,pattern)).sort():[pattern];for(const imported of files)visit(imported,parseXml(this.text(imported)),depth+1);}catch(error){this.diagnostic(path,error.message,'error','SFP1202');}
      }
      else if(child.name==='Choose'){if(depth>64)throw new Error('Choose nesting limit exceeded');let branch=child.children.find(n=>n.name==='When'&&enabled(n));branch??=child.children.find(n=>n.name==='Otherwise');if(branch)walk(branch.children,depth+1);}
      else if(child.name==='Target'){targets.push({name:child.attributes.Name??'',file:currentFile,attributes:{...child.attributes},tasks:child.children.map(t=>t.name)});this.diagnostic(path,'Target execution requires native MSBuild; use the MSBuild tool.','error','SFP1004');}
      else if(child.name==='UsingTask'){usingTasks.push({file:currentFile,...child.attributes});this.diagnostic(path,'Custom tasks require native MSBuild; use the MSBuild tool.','error','SFP1004');}
      else if(!['Sdk','ProjectExtensions'].includes(child.name))this.diagnostic(path,`${child.name} is not executed by the browser project loader.`,'error','SFP1004');
    }};
    for(const file of [before,path,after].filter(Boolean))visit(file,file===path?xml:parseXml(this.text(file)));
    const definitions=Object.create(null);
    for(const {node,file}of definitionGroups)withFile(file,()=>{if(enabled(node))for(const item of node.children)if(enabled(item)){definitions[item.name]??=Object.create(null);for(const m of item.children)if(enabled(m))definitions[item.name][m.name]=expand(m.text.trim());}});
    // SDK default Compile items are evaluated before explicit Include/Remove operations.
    const compile=new Map(),all=[...this.files.keys()].sort();
    if(sdk&&props.enabledefaultitems?.toLowerCase()!=='false'&&props.enabledefaultcompileitems?.toLowerCase()!=='false'){
      for(const file of all){const rel=base?file.startsWith(base+'/')?file.slice(base.length+1):null:file;if(rel!==null&&/\.cs$/i.test(rel)&&!/(^|\/)(bin|obj|\.[^/]*)(\/|$)/i.test(rel))compile.set(file,{path:file,link:definitions.Compile?.Link??null,...(definitions.Compile?{metadata:{...definitions.Compile}}:{})});}
    }
    const candidates=(value,exclude='')=>{const out=[];for(const raw of splitList(expand(value))){const pattern=raw.startsWith('/')&&String(value).includes('$(')?normalizePath(raw.slice(1)):normalizePath(raw,base);const found=/[*?]/.test(pattern)?all.filter(file=>matchesGlob(file,pattern)):[pattern];const omit=splitList(expand(exclude)).map(p=>p.startsWith('/')&&String(exclude).includes('$(')?normalizePath(p.slice(1)):normalizePath(p,base));for(const p of found)if(!omit.some(x=>matchesGlob(p,x)))out.push(p);}return [...new Set(out)];};
    for(const pattern of splitList(props.defaultitemexcludes)){try{const p=normalizePath(pattern,base);for(const file of compile.keys())if(matchesGlob(file,p))compile.delete(file);}catch(e){this.diagnostic(path,e.message,'error');}}
    const projectReferences=[],references=[],packageReferences=[],additionalFiles=[],analyzers=[],itemMaps=Object.fromEntries(['None','Content','EmbeddedResource','Folder'].map(k=>[k,new Map()]));
    for(const {node:group,file:groupFile} of itemGroups)withFile(groupFile,()=>{if(!enabled(group))return;for(const item of group.children){if(!enabled(item))continue;const a=item.attributes;
      const metadata={...definitions[item.name],...Object.fromEntries(Object.entries(a).filter(([k])=>!['Include','Exclude','Update','Remove','Condition'].includes(k)).map(([k,v])=>[k,expand(v)])),...Object.fromEntries(item.children.filter(enabled).map(m=>[m.name,expand(m.text.trim())]))};
      try{
        if(item.name==='Compile'){
          if(a.Remove){for(const target of candidates(a.Remove))compile.delete(target);}
          if(a.Include)for(const target of candidates(a.Include,a.Exclude)){if(compile.has(target))this.diagnostic(path,`Duplicate Compile item '${target}'.`,'error','SFP1022');compile.set(target,{path:target,link:metadata.Link??(a.Link?expand(a.Link):null),...(Object.keys(metadata).length?{metadata:{...metadata}}:{})});}
          if(a.Update)for(const target of candidates(a.Update))if(compile.has(target))compile.set(target,{...compile.get(target),link:metadata.Link??(a.Link?expand(a.Link):compile.get(target).link),...(Object.keys(metadata).length?{metadata:{...compile.get(target).metadata,...metadata}}:{})});
         }else if(item.name==='ProjectReference'){
          if(a.Remove){const paths=new Set(candidates(a.Remove));for(let i=projectReferences.length-1;i>=0;i--)if(paths.has(projectReferences[i].path))projectReferences.splice(i,1);}
          if(a.Update){const paths=new Set(candidates(a.Update));for(const ref of projectReferences)if(paths.has(ref.path))ref.metadata={...ref.metadata,...metadata};}
          if(a.Include)for(const target of candidates(a.Include,a.Exclude))projectReferences.push({path:target,metadata});
        }else if(item.name==='Reference'||item.name==='PackageReference'){
          const list=item.name==='Reference'?references:packageReferences;
          if(a.Remove){const patterns=splitList(expand(a.Remove));for(let i=list.length-1;i>=0;i--)if(patterns.some(p=>matchesGlob(list[i].name,p)))list.splice(i,1);}
          if(a.Update){const patterns=splitList(expand(a.Update));for(const ref of list)if(patterns.some(p=>matchesGlob(ref.name,p))){ref.metadata={...ref.metadata,...metadata};if(item.name==='PackageReference'&&(a.Version||metadata.Version))ref.version=expand(a.Version??metadata.Version);if(item.name==='Reference'&&metadata.HintPath)ref.hintPath=resolve(metadata.HintPath);}}
          if(a.Include)for(const name of splitList(expand(a.Include)))list.push(item.name==='Reference'?{name,hintPath:metadata.HintPath?resolve(metadata.HintPath):null,metadata}:{name,version:expand(a.Version??metadata.Version??''),metadata});
        }else if(item.name==='AdditionalFiles'||item.name==='Analyzer'){
          const list=item.name==='AdditionalFiles'?additionalFiles:analyzers;
          if(a.Remove){const paths=new Set(candidates(a.Remove));for(let i=list.length-1;i>=0;i--)if(paths.has(list[i]))list.splice(i,1);}
          if(a.Include)for(const target of candidates(a.Include,a.Exclude))if(!list.includes(target))list.push(target);
        }
        else if(itemMaps[item.name]){const map=itemMaps[item.name];if(a.Remove)for(const target of candidates(a.Remove))map.delete(target);if(a.Update)for(const target of candidates(a.Update))if(map.has(target))map.set(target,{...map.get(target),metadata:{...map.get(target).metadata,...metadata}});if(a.Include)for(const target of candidates(a.Include,a.Exclude))map.set(target,{path:target,itemType:item.name,metadata});}
        else this.diagnostic(path,`Item type '${item.name}' is not evaluated.`,'error');
      }catch(e){this.diagnostic(path,e.message,'error');}
    }});
    for(let i=projectReferences.length-1;i>=0;i--)if(String(projectReferences[i].metadata.ReferenceOutputAssembly??'true').toLowerCase()==='false')projectReferences.splice(i,1);
    if(itemMaps.EmbeddedResource.size)this.diagnostic(path,'EmbeddedResource files are not emitted.','error');
    const items=Object.values(itemMaps).flatMap(map=>[...map.values()]);
    for(const ref of references)this.diagnostic(path,`Binary reference '${ref.name}' is inspectable but not linked by the source compiler.`,'error','SFP1101');
    for(const ref of packageReferences)this.diagnostic(path,`Package '${ref.name}' is recorded; restore/linking require native MSBuild, not the browser preview.`,'error','SFP1102');
    if(analyzers.length)this.diagnostic(path,'Roslyn Analyzer DLLs are inspection-only; JavaScript extensions use Tools → Generators & analyzers.','error','SFP1103');
    for(const file of compile.keys())if(!this.files.has(file)||typeof this.files.get(file).text!=='string')this.diagnostic(path,`Compile file '${file}' is missing. Open the containing folder or select all referenced files.`,'error','SFP1005');
    const frameworks=splitList(props.targetframeworks??props.targetframework??'');if(frameworks.length>1)this.diagnostic(path,`Multi-targeting is loaded for inspection; the browser uses one runtime profile, not ${frameworks.join(', ')}.`);
    return {path,imports,targets,usingTasks,itemDefinitions:definitions,name:props.assemblyname??props.msbuildprojectname,sdk,properties:{...props},targetFramework:props.targetframework??frameworks[0]??'',targetFrameworks:frameworks,outputType:props.outputtype??'Library',items,compile:[...compile.values()],projectReferences,references,packageReferences,additionalFiles,analyzers};
  }
  snapshot(){return {solution:this.solution,projects:[...this.projects.values()],diagnostics:[...this.diagnostics],configuration:this.configuration,platform:this.platform};}
  /** A source-combined preview, NOT separately linked project outputs. */
  compilationFiles(startup=this.solution?.projectPaths[0]){
    if(!this.projects.has(startup))throw new Error('Startup project was not loaded');const paths=new Set(),seen=new Set();
    const visit=path=>{if(seen.has(path))return;seen.add(path);const project=this.projects.get(path);if(!project)return;for(const ref of project.projectReferences)visit(ref.path);for(const item of project.compile)paths.add(item.path);};visit(startup);
    return [...paths].filter(path=>typeof this.files.get(path)?.text==='string').map(uri=>({uri,text:this.files.get(uri).text,version:1}));
  }
  compilationOptions(startup=this.solution?.projectPaths[0]){
    if(!this.projects.has(startup))throw new Error('Startup project was not loaded');
    const checked=project=>{const value=String(project.properties.checkforoverflowunderflow??'false').trim().toLowerCase();if(!['true','false'].includes(value))throw new Error(`Invalid CheckForOverflowUnderflow in ${project.path}`);return value==='true';};
    const checkOverflowByUri=Object.create(null),langVersionByUri=Object.create(null);
    const language=project=>{const raw=String(project.properties.langversion??'14').trim().toLowerCase();if(['latest','latestmajor','default'].includes(raw))return '14';if(raw==='preview')return raw;if(/^(?:[1-9]|1[0-4])(?:\.0)?$/.test(raw))return String(Number(raw));throw new Error(`Invalid or unsupported LangVersion '${raw}' in ${project.path}; use 14 or preview for the newest implemented features`);};
    for(const path of this.closure(startup)){const project=this.projects.get(path);if(!project)continue;const value=checked(project);for(const item of project.compile){if(Object.hasOwn(checkOverflowByUri,item.path)&&checkOverflowByUri[item.path]!==value)throw new Error(`Linked source '${item.path}' has conflicting overflow settings in the source-combined build`);checkOverflowByUri[item.path]=value;const lang=language(project);if(Object.hasOwn(langVersionByUri,item.path)&&langVersionByUri[item.path]!==lang)throw new Error(`Linked source '${item.path}' has conflicting language versions in the source-combined build`);langVersionByUri[item.path]=lang;}}
    return {outputKind:this.projects.get(startup).outputType.toLowerCase()==='library'?'library':'exe',checkOverflow:checked(this.projects.get(startup)),checkOverflowByUri,langVersion:language(this.projects.get(startup)),langVersionByUri};
  }
  closure(startup){const seen=new Set();const visit=path=>{if(seen.has(path))return;seen.add(path);for(const r of this.projects.get(path)?.projectReferences??[])visit(r.path);};visit(startup);return seen;}
}

export function createCsproj({assemblyName='Application',targetFramework='net10.0',outputType='Exe',files=[]}={}){
  return `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>${xmlEscape(outputType)}</OutputType>\n    <TargetFramework>${xmlEscape(targetFramework)}</TargetFramework>\n    <AssemblyName>${xmlEscape(assemblyName)}</AssemblyName>\n${files.length?'    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>\n':''}  </PropertyGroup>\n${files.length?'  <ItemGroup>\n'+files.map(f=>`    <Compile Include="${xmlEscape(normalizePath(f))}" />`).join('\n')+'\n  </ItemGroup>\n':''}</Project>\n`;
}
export function createSlnx(projects){return `<Solution>\n${projects.map(path=>`  <Project Path="${xmlEscape(normalizePath(path))}" />`).join('\n')}\n</Solution>\n`;}
export * from './project-edit-exports.js';
export * from './archive.js';

export {decodeWorkspaceFile,encodeWorkspaceFile} from '@sharpforge/archive';

export {renameSolutionFolder,removeSolutionFolder,moveSolutionProject,addSolutionItem} from './explorer.js';

export {importWorkspaceRecords,workspaceManifestRecord} from './archive.js';
