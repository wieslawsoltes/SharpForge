import {SourceText} from '@sharpforge/text';
import {lex,keywords} from '@sharpforge/syntax';
import {bracketPairs} from './operations.js';
/** Immutable source-backed index. Lex once per source revision; render only visible lines.
 * Text input remains a native textarea. This is syntax/gutter virtualization, not a rope editor.
 */
export class SyntaxHighlightIndex {
  constructor(source,{maxLexCharacters=2_000_000}={}) {
    this.source=source instanceof SourceText?source:new SourceText(source);
    if(!Number.isSafeInteger(maxLexCharacters)||maxLexCharacters<0)throw new RangeError('Invalid lexical character limit');
    this.lexed=this.source.length<=maxLexCharacters?lex(this.source):null;
    this.pairs=this.lexed?bracketPairs(this.source.text,this.lexed.tokens):new Map();this.runs=[];
    if(!this.lexed)return;
    const push=(start,end,kind='',bracket=false)=>{if(end>start)this.runs.push({start,end,kind,bracket});};
    this.lexed.tokens.forEach((token,index,tokens)=>{
      let at=token.fullStart;
      for(const match of token.green.leading.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)){
        const begin=token.fullStart+match.index;push(at,begin);push(begin,begin+match[0].length,'comment');at=begin+match[0].length;
      }
      push(at,token.start);
      const kind=['string','char','interpolated'].includes(token.kind)?'string':['integer','double'].includes(token.kind)?'number':keywords.has(token.kind)?'keyword':token.kind==='identifier'?(tokens[index-1]?.kind==='class'||token.text[0]===token.text[0]?.toUpperCase()&&token.text[0]!==token.text[0]?.toLowerCase()?'type':tokens[index+1]?.kind==='('?'method':'identifier'):'punctuation';
      push(token.start,token.end,kind,this.pairs.has(token.start));
    });
  }
  window({scrollTop=0,height=400,lineHeight=22,padding=14,overscan=4,maxRuns=10000}={}) {
    if(![scrollTop,height,lineHeight,padding,overscan,maxRuns].every(Number.isFinite)||scrollTop<0||height<0||lineHeight<=0||overscan<0||overscan>100||!Number.isInteger(maxRuns)||maxRuns<1)throw new RangeError('Invalid highlight viewport');
    const starts=this.source.lineStarts,first=Math.min(starts.length-1,Math.max(0,Math.floor((scrollTop-padding)/lineHeight)-Math.floor(overscan))),
      last=Math.min(starts.length,first+Math.min(2000,Math.ceil(height/lineHeight)+Math.ceil(overscan)*2+2)),start=starts[first],end=starts[last]??this.source.length;
    let low=0,high=this.runs.length;
    while(low<high){const middle=(low+high)>>>1;if(this.runs[middle].end<=start)low=middle+1;else high=middle;}
    const runs=[];let truncated=false;
    for(let i=low;i<this.runs.length&&this.runs[i].start<end;i++){
      if(runs.length>=maxRuns){truncated=true;break;}
      const run=this.runs[i];runs.push({...run,start:Math.max(start,run.start),end:Math.min(end,run.end)});
    }
    // Preserve every character even when one giant line exceeds the DOM token budget.
    if(!this.lexed||truncated){runs.length=0;if(end>start)runs.push({start,end,kind:'',bracket:false});}
    return {firstLine:first,lastLine:last,start,end,runs,syntax:!!this.lexed&&!truncated,characters:end-start};
  }
}
