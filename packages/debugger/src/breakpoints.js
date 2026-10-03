/** Preserve source breakpoint anchors through a single text-buffer revision. UTF-16 offsets. */
export function remapSourceBreakpoints(before,after,breakpoints){
 if(typeof before!=='string'||typeof after!=='string'||!Array.isArray(breakpoints))throw new TypeError('Expected source text and breakpoint array');
 if(before===after)return breakpoints.map(b=>({...b}));
 let prefix=0;while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
 let oldEnd=before.length,newEnd=after.length;while(oldEnd>prefix&&newEnd>prefix&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
 const starts=text=>{const result=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')result.push(i+1);return result;};
 const oldLines=starts(before),newLines=starts(after),atLine=offset=>{let lo=0,hi=newLines.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(newLines[mid]<=offset)lo=mid;else hi=mid;}return lo+1;};
 const used=new Set();return breakpoints.map(bp=>{
  const oldOffset=oldLines[Math.min(oldLines.length-1,Math.max(0,(bp.line??1)-1))],end=oldLines[bp.line]??before.length;
  let next=oldOffset<prefix?oldOffset:oldOffset>=oldEnd?oldOffset+newEnd-oldEnd:prefix;
  if(oldOffset<oldEnd&&end>prefix){const anchor=before.slice(oldOffset,end).trim();if(anchor){const candidates=[];for(let i=Math.max(0,atLine(prefix)-2);i<newLines.length&&newLines[i]<=newEnd;i++)if(after.slice(newLines[i],newLines[i+1]??after.length).trim()===anchor)candidates.push(i);if(candidates.length===1)next=newLines[candidates[0]];}}
  const line=atLine(Math.max(0,Math.min(after.length,next)));return {...bp,line,column:bp.column,verified:undefined,requestedLine:undefined};
 }).filter(bp=>{const key=bp.line+':'+(bp.column??'')+':'+(bp.condition??'')+':'+(bp.hitCondition??'')+':'+(bp.logMessage??'');if(used.has(key))return false;used.add(key);return true;});
}
/** Map the displayed bound location back to its persisted request, never create a duplicate. */
export function sourceBreakpointAt(requested,bound,line){
 const resolved=bound?.find(b=>b.line===line);return requested.find(b=>b.line===(resolved?.requestedLine??line))??requested.find(b=>b.line===line)??null;
}
