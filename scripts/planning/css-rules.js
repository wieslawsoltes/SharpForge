import {createHash} from 'node:crypto';

// Preserve complete top-level rules, including nested at-rules and declaration
// order. This boundary scanner does not normalize quoted strings or selectors.
export function cssRules(css) {
  if(typeof css!=='string')throw new TypeError('CSS must be a string');
  const rules=[];let start=-1,depth=0,paren=0,bracket=0,quote=null,comment=false;
  const fail=(message,index)=>{throw new SyntaxError(`${message} at CSS offset ${index}`);};
  for(let i=0;i<css.length;i++) {
    const c=css[i],next=css[i+1];
    if(comment){if(c==='*'&&next==='/'){comment=false;i++;}continue;}
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
    if(c==='/'&&next==='*'){comment=true;i++;continue;}
    if(start<0&&/\s/.test(c))continue;
    if(start<0)start=i;
    if(c==='\\'){i++;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='('){paren++;continue;}if(c===')'){if(!paren)fail('Unexpected closing parenthesis',i);paren--;continue;}
    if(c==='['){bracket++;continue;}if(c===']'){if(!bracket)fail('Unexpected closing bracket',i);bracket--;continue;}
    if(paren||bracket)continue;
    if(c==='{'){depth++;continue;}
    if(c==='}'){
      if(!depth)fail('Unexpected closing brace',i);
      if(--depth===0){rules.push(css.slice(start,i+1).trim());start=-1;}
    } else if(c===';'&&depth===0){
      if(css[start]!=='@')fail('Top-level declaration outside a rule',i);
      rules.push(css.slice(start,i+1).trim());start=-1;
    }
  }
  if(comment||quote||depth||paren||bracket||start>=0)fail('Unterminated CSS rule, comment or string',css.length);
  return rules;
}
const hash=value=>createHash('sha256').update(value).digest('hex');
export function cssFingerprint(css) {
  const rules=cssRules(css);
  return {bytes:Buffer.byteLength(css),sha256:hash(css),ruleCount:rules.length,orderedRulesSha256:hash(JSON.stringify(rules)),sortedRulesSha256:hash(JSON.stringify([...rules].sort()))};
}
