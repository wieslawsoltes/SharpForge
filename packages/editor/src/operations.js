import {SourceText,findTextMatches} from '@sharpforge/text';
import {lex} from '@sharpforge/syntax';
/** Matching punctuation only; comments, strings and character literals are never bracket sources. */
export function bracketPairs(text,tokens=lex(new SourceText(text)).tokens){
  const pairs=new Map(),stack=[],closing={')':'(',']':'[','}':'{'};
  for(const token of tokens){if(['(','[','{'].includes(token.kind))stack.push(token);else if(closing[token.kind]){const open=stack.pop();if(open?.kind===closing[token.kind]){pairs.set(open.start,token.start);pairs.set(token.start,open.start);}else stack.length=0;}}
  return pairs;
}
/** Context at an insertion position. Input is UTF-16; the caller may pass its cached tokens. */
export function lexicalContext(text,offset,tokens=lex(new SourceText(text)).tokens){
  if(!Number.isInteger(offset)||offset<0||offset>text.length)throw new RangeError('Invalid insertion position');
  for(const token of tokens){
    if(['string','char'].includes(token.kind)&&offset>token.start&&(offset<token.end||offset===token.end&&token.text.at(-1)!==token.text[0]))return 'literal';
    if(offset>=token.fullStart&&offset<=token.start){for(const match of token.green.leading.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)){const start=token.fullStart+match.index,end=start+match[0].length;if(offset>=start+2&&(offset<end||offset===end&&(match[0].startsWith('//')||!match[0].endsWith('*/'))))return 'comment';}}
    if(token.fullStart>offset)break;
  }
  return 'code';
}
/** Bounded literal replacement. The result is computed before the caller mutates the buffer. */
export function replaceLiteral(text,query,replacement,options={}){
  if(typeof replacement!=='string'||replacement.length>100000)throw new RangeError('Replacement exceeds 100000 characters');
  const found=findTextMatches([{uri:'buffer',text}],query,{...options,maxMatches:10000});if(found.truncated)throw new RangeError('More than 10000 replacements; narrow the search');
  const size=text.length+found.matches.reduce((n,m)=>n+replacement.length-(m.end-m.start),0);if(size>(options.maxLength??2_000_000))throw new RangeError('Replacement would exceed the document limit');
  const chunks=[];let at=0;for(const m of found.matches){chunks.push(text.slice(at,m.start),replacement);at=m.end;}chunks.push(text.slice(at));return {text:chunks.join(''),count:found.matches.length,matches:found.matches};
}
export function duplicateLineBlock(text,start,end=start,direction=1){
  if(![1,-1].includes(direction)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>text.length)throw new RangeError('Invalid line selection');
  const source=new SourceText(text),first=source.positionAt(start).line,last=source.positionAt(end>start&&text[end-1]==='\n'?end-1:end).line,lines=text.split('\n'),block=lines.slice(first,last+1),insertAt=direction>0?last+1:first;
  lines.splice(insertAt,0,...block);const result=lines.join('\n'),next=new SourceText(result),line=direction>0?last+1:first;
  return {text:result,start:next.lineStarts[line],end:next.lineStarts[line]+block.join('\n').length};
}
