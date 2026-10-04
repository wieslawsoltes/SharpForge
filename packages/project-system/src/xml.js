import {parseXmlCst} from './xml-cst.js';
export {parseXmlCst,serializeXmlCst,applyXmlEdits,decodeXmlText} from './xml-cst.js';

/** Bounded XML data parser; cst mode retains exact concrete source spans without changing the default data tree. */
export function parseXml(source, {maxLength=2_000_000,maxNodes=20000,maxDepth=64,cst=false,signal}={}) {
  if (cst) return parseXmlCst(source, {maxLength,maxNodes,maxDepth,signal});
  signal?.throwIfAborted();
  if (typeof source !== 'string' || source.length > maxLength) throw new Error('XML exceeds the text limit');
  source=source.replace(/^\uFEFF/,'');
  const root={name:'#document',attributes:Object.create(null),children:[],text:'',start:0},stack=[root];
  let p=0,nodes=0;
  const fail=message=>{throw new Error(`${message} at XML offset ${p}`);};
  const ws=()=>{while (/\s/.test(source[p]??'') && p<source.length) p++;};
  const name=()=>{const m=/^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(p));if(!m)fail('Expected XML name');p+=m[0].length;return m[0];};
  const decode=value=>value.replace(/&([^;]*);|&/g,(whole,entity)=>{
    const predefined={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if(Object.hasOwn(predefined,entity))return predefined[entity];
    if(/^#(?:x[0-9a-f]+|\d+)$/i.test(entity??'')){
      const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
      if(code===9||code===10||code===13||code>=32&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)&&code!==0xfffe&&code!==0xffff)return String.fromCodePoint(code);
    }
    fail('Unsupported or invalid XML entity');
  });
  while(p<source.length){
    if(source.startsWith('<!--',p)){const end=source.indexOf('-->',p+4);if(end<0||source.slice(p+4,end).includes('--'))fail('Invalid XML comment');p=end+3;continue;}
    if(source.startsWith('<?',p)){const end=source.indexOf('?>',p+2);if(end<0)fail('Unterminated processing instruction');p=end+2;continue;}
    if(source.startsWith('<![CDATA[',p)){const end=source.indexOf(']]>',p+9);if(end<0)fail('Unterminated CDATA');stack.at(-1).text+=source.slice(p+9,end);p=end+3;continue;}
    if(source.startsWith('<!',p))fail('DTD and entity declarations are not permitted');
    if(source.startsWith('</',p)){p+=2;const closing=name();ws();if(source[p++]!=='>')fail('Expected closing >');if(stack.length===1||stack.pop().name!==closing)fail('Mismatched closing tag');continue;}
    if(source[p]==='<'){
      const start=p++;const tag=name(),attributes=Object.create(null);let closed=false;
      for(;;){const before=p;ws();if(source.startsWith('/>',p)){p+=2;closed=true;break;}if(source[p]==='>'){p++;break;}if(p===before)fail('Expected attribute separator');const key=name();if(Object.hasOwn(attributes,key))fail('Duplicate XML attribute');ws();if(source[p++]!=='=')fail('Expected =');ws();const quote=source[p++];if(!['"',"'"].includes(quote))fail('Expected quoted attribute');const end=source.indexOf(quote,p);if(end<0)fail('Unterminated attribute');const value=source.slice(p,end);if(value.includes('<'))fail('Invalid < in attribute');attributes[key]=decode(value);p=end+1;}
      if(++nodes>maxNodes)fail('XML node limit exceeded');const node={name:tag,attributes,children:[],text:'',start};stack.at(-1).children.push(node);
      if(!closed){if(stack.length>=maxDepth)fail('XML nesting limit exceeded');stack.push(node);}continue;
    }
    let end=source.indexOf('<',p);if(end<0)end=source.length;stack.at(-1).text+=decode(source.slice(p,end));p=end;
  }
  if(stack.length!==1||root.children.length!==1||root.text.trim())fail('XML must contain exactly one complete root');
  return root.children[0];
}
export const xmlEscape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
