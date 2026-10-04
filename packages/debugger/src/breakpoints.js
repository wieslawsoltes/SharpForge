export {remapSourceBreakpoints} from './breakpoint-remap.js';
/** Map the displayed bound location back to its persisted request, never create a duplicate. */
export function sourceBreakpointAt(requested,bound,line){
 const resolved=bound?.find(b=>b.line===line);return requested.find(b=>b.line===(resolved?.requestedLine??line))??requested.find(b=>b.line===line)??null;
}
