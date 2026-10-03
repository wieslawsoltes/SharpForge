import {parseXml,normalizePath,directoryName,xmlEscape} from '@sharpforge/project-system';
/** Data-only .slnx structure. Native MSBuild, not this view, interprets configuration rules. */
export function inspectSlnx(text,{path='Workspace.slnx'}={}){
 const root=parseXml(text,{maxLength:4*1024*1024,maxNodes:50000});if(root.name!=='Solution')throw new Error('Expected <Solution> root');
 const base=directoryName(normalizePath(path)),projects=[],folders=[],files=[],configurations=[],other=[];
 const record=n=>({element:n.name,attributes:{...n.attributes},...(n.text.trim()?{text:n.text.trim()}:{}),...(n.children.length?{children:n.children.map(record)}:{})});
 const visit=(node,folder='')=>{for(const n of node.children){if(n.name==='Folder'){const name=n.attributes.Name??'',next=name.startsWith('/')?name:(folder+'/'+name).replace(/\/+/g,'/');folders.push({name:next,attributes:{...n.attributes}});visit(n,next);}else if(n.name==='Project'){projects.push({path:normalizePath(n.attributes.Path??'',base),folder,attributes:{...n.attributes},rules:n.children.map(record)});}else if(n.name==='File')files.push({path:normalizePath(n.attributes.Path??'',base),folder});else if(n.name==='Configurations')configurations.push(record(n));else other.push(record(n));}};visit(root);
 return {path,attributes:{...root.attributes},configurations,projects,folders,files,other,semantics:'Structural inspection only. Native MSBuild interprets build/deploy mappings, dependency rules and project-type defaults.'};
}
/** Create a .slnx in any existing workspace directory, linking projects relative to it. */
export function createWorkspaceSlnx(path,projects){const parent=directoryName(normalizePath(path)).split('/').filter(Boolean);return '<Solution>\n'+projects.map(p=>{const parts=normalizePath(p).split('/');let at=0;while(at<parent.length&&parent[at]===parts[at])at++;const relative=[...parent.slice(at).map(()=>'..'),...parts.slice(at)].join('/');return `  <Project Path="${xmlEscape(relative)}" />`;}).join('\n')+'\n</Solution>\n';}
