const pathOf=node=>node?.kind==='Name'?node.name:node?.kind==='Member'&&pathOf(node.target)?pathOf(node.target)+'.'+node.name:null;
const synchronizationOwner=name=>/^(?:System\.Threading\.)?(?:Monitor|Interlocked|Volatile)$/.test(name??'');

/** Call before ordinary Parser.statement dispatch; null consumes no tokens. */
export function parseSynchronizationStatement(parser) {
  if(!parser.at('lock'))return null;
  const start=parser.take();parser.expect('(');const expression=parser.expression();parser.expect(')');
  const body=parser.statement();
  return parser.node('Lock',start,{expression,body});
}

/** Call from Parser.prefix after consuming its leading token. */
export function parseSynchronizationPrefix(parser,token) {
  if(!['ref','out','in'].includes(token.kind))return null;
  return parser.node('RefArgument',token,{modifier:token.kind,expression:parser.expression(14)});
}

/** A narrow generic-call suffix; ordinary relational '<' keeps its grammar. */
export function parseSynchronizationTypeArguments(parser,left) {
  if(!parser.at('<')||left?.kind!=='Member'||!synchronizationOwner(pathOf(left.target)))return null;
  let at=parser.i,depth=0;
  do{const kind=parser.tokens[at++]?.kind;depth+=kind==='<'?1:kind==='>'?-1:kind==='>>'?-2:0;if(at-parser.i>128)return null;}while(depth>0&&at<parser.tokens.length);
  if(depth!==0||parser.tokens[at]?.kind!=='(')return null;
  parser.take();const typeArguments=[];
  do{typeArguments.push(parser.type());}while(parser.match(','));
  parser.expect('>');
  return {...left,typeArguments,end:parser.tokens[parser.i-1].end};
}
