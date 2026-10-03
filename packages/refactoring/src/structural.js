/** Structural rewrites are deliberately narrow: each offered action has an explicit evaluation-order contract. */
export function structuralActions(workspace,uri,start,end,compilation,syntax){
  if(!compilation.success)return [];
  const source=syntax.source,text=source.text,all=[],parents=new Map(),stack=[syntax.root];
  while(stack.length){const node=stack.pop();if(!node||typeof node!=='object')continue;if(node.kind)all.push(node);for(const [key,value]of Object.entries(node)){if(['tokens','source','green'].includes(key))continue;for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&child.kind){parents.set(child,node);stack.push(child);}}}
  const result=[],version=source.version,eol=text.includes('\r\n')?'\r\n':'\n',span=node=>text.slice(node.start,node.end),edit=(node,newText)=>({uri,start:node.start,end:node.end,newText,version});
  const names=new Set(compilation.symbols.map(s=>s.name));for(const token of syntax.tokens)if(token.kind==='identifier')names.add(token.value);
  const unique=base=>{let name=base,n=1;while(names.has(name))name=base+(++n);return name;};
  const indent=node=>text.slice(text.lastIndexOf('\n',node.start-1)+1,node.start).match(/^[\t ]*/)?.[0]??'';
  const listMember=node=>['Block','CompilationUnit'].includes(parents.get(node)?.kind)&&parents.get(node).statements?.includes(node);
  const local=all.filter(n=>n.kind==='Local'&&n.start<=start&&n.end>=end&&n.declarations.length===1&&listMember(n)).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  if(local){
    const variable=local.declarations[0],symbol=compilation.symbols.find(s=>s.uri===uri&&s.start===variable.nameSpan.start&&s.kind==='local'),value=variable.initializer;
    if(symbol&&value?.kind==='Literal'&&value.type===symbol.type&&['int','double','string','bool'].includes(value.type)&&!span(local).includes('/*')&&!span(local).includes('//')){
      const refs=compilation.references.filter(r=>r.symbolId===symbol.id&&!r.declaration);
      const unsafe=refs.some(ref=>{const node=all.find(n=>n.kind==='Name'&&n.start===ref.start&&n.end===ref.end),parent=parents.get(node);return !node||parent?.kind==='Assignment'&&parent.left===node||['Unary','Postfix'].includes(parent?.kind)&&['++','--'].includes(parent.operator)||parent?.kind==='Call'&&parent.target?.name==='nameof';});
      if(refs.length&&!unsafe)result.push({title:`Inline constant value of '${variable.name}'`,kind:'refactor.inline',edits:[edit(local,''),...refs.map(ref=>({...ref,uri,version,newText:'('+span(value)+')'}))]});
    }
  }
  if(end>start){
    const expression=all.find(n=>n.start===start&&n.end===end),parent=parents.get(expression);
    const declaration=parent?.kind==='Variable'?parents.get(parent):parent?.kind==='Return'?parent:null;
    const allowed=declaration&&listMember(declaration)&&(declaration.kind==='Return'||declaration.declarations.length===1&&!declaration.declarations[0].isConst)&&((parent.kind==='Variable'&&parent.initializer===expression)||(parent.kind==='Return'&&parent.expression===expression));
    // A whole initializer/return expression moves directly before its statement, never outside a branch or loop.
    if(allowed&&!(expression.kind==='Literal'&&expression.type==='null')){const name=unique('value');result.push({title:`Introduce local '${name}'`,kind:'refactor.extract',edits:[{uri,start:declaration.start,end:declaration.start,version,newText:`var ${name} = ${span(expression)};${eol}${indent(declaration)}`},edit(expression,name)]});}
  }
  const conditional=all.filter(n=>n.kind==='If'&&n.start<=start&&n.end>=end&&n.then?.kind==='Block'&&n.otherwise?.kind==='Block').sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  if(conditional)result.push({title:'Invert if / else',kind:'refactor.rewrite',edits:[edit(conditional.condition,'!('+span(conditional.condition)+')'),edit(conditional.then,span(conditional.otherwise)),edit(conditional.otherwise,span(conditional.then))]});
  const property=all.find(n=>n.kind==='Property'&&n.start<=start&&n.end>=end&&n.accessors.length===2&&n.accessors.every(a=>!a.body)&&n.accessors.some(a=>a.name==='get')&&n.accessors.some(a=>a.name==='set'));
  if(property){const field=unique('_'+property.name[0].toLowerCase()+property.name.slice(1)),space=indent(property),modifiers=property.modifiers.join(' '),name=text.slice(property.nameSpan.start,property.nameSpan.end),staticPart=property.modifiers.includes('static')?' static':'',init=property.initializer?' = '+span(property.initializer):'';
    const accessor=a=>space+'    '+(a.modifiers.length?a.modifiers.join(' ')+' ':'')+a.name+' => '+(a.name==='get'?field:field+' = value')+';';
    const replacement=`private${staticPart} ${property.type} ${field}${init};${eol}${space}${modifiers?modifiers+' ':''}${property.type} ${name}${eol}${space}{${eol}${property.accessors.map(accessor).join(eol)}${eol}${space}}`;
    result.push({title:`Expand auto-property '${property.name}'`,kind:'refactor.rewrite',edits:[edit(property,replacement)]});
  }
  const commentFree=node=>!syntax.tokens.some(t=>t.fullStart>=node.start&&t.start<=node.end&&/\/\/|\/\*/.test(t.green.leading));
  if(local){
    const variable=local.declarations[0],symbol=compilation.symbols.find(s=>s.uri===uri&&s.start===variable.nameSpan.start&&s.kind==='local');
    if(!variable.isConst&&variable.initializer?.kind==='Literal'&&variable.initializer.type===symbol?.type&&['int','double','bool','string'].includes(symbol.type)){
      const writes=compilation.references.filter(r=>r.symbolId===symbol.id&&!r.declaration).some(ref=>{const n=all.find(n=>n.kind==='Name'&&n.start===ref.start),parent=parents.get(n);return parent?.kind==='Assignment'&&parent.left===n||['Unary','Postfix'].includes(parent?.kind)&&['++','--'].includes(parent.operator);});
      if(!writes){const typeToken=syntax.tokens.find(t=>t.start===local.start);if(typeToken)result.push({title:`Make '${variable.name}' constant`,kind:'refactor.rewrite',edits:[edit(typeToken,'const '+symbol.type)]});}
    }
  }
  const returns=conditional&&conditional.then.statements.length===1&&conditional.otherwise.statements.length===1&&conditional.then.statements[0].kind==='Return'&&conditional.otherwise.statements[0].kind==='Return';
  if(returns&&conditional.then.statements[0].expression&&conditional.otherwise.statements[0].expression&&commentFree(conditional))result.push({title:'Use conditional return expression',kind:'refactor.rewrite',edits:[edit(conditional,`return (${span(conditional.condition)}) ? (${span(conditional.then.statements[0].expression)}) : (${span(conditional.otherwise.statements[0].expression)});`)]});
  const method=all.filter(n=>n.kind==='Method'&&n.start<=start&&n.end>=end&&n.body?.statements.length===1).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  if(method&&method.name!=='.ctor'&&span(method.body).startsWith('{')&&commentFree(method.body)){
    const statement=method.body.statements[0];if(statement.expression&&(statement.kind==='Return'||statement.kind==='ExpressionStatement'&&method.returnType==='void'))result.push({title:'Use expression-bodied method',kind:'refactor.rewrite',edits:[edit(method.body,`=> ${span(statement.expression)};`)]});
  }
  const using=all.filter(n=>n.kind==='Using'&&n.start<=start&&n.end>=end&&n.resources.kind==='Local'&&n.body.kind==='Block'&&commentFree(n)).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  // Retain a fresh lexical block so the disposal point and resource-variable scope cannot widen.
  if(using){const space=indent(using);result.push({title:'Use scoped using declaration',kind:'refactor.rewrite',edits:[edit(using,`{${eol}${space}    using ${span(using.resources)};${eol}${span(using.body).slice(1)}`)]});}
  return result;
}
