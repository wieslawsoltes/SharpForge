/**
 * Type-name spans (SF-A02-T24): where in the lossless syntax tree a declaration names its type.
 *
 * The plain AST carries types as text, so a declaration node alone cannot say where its type was written. Roslyn
 * reports CS0246, CS0104 and friends on the type syntax (and on the element type of an array type), so the binder asks
 * the red tree: `typeSyntaxSpan(root,node,typeText)` returns the span of the type syntax spelled `typeText` in or next
 * to the declaration `node`, or null when the tree has no such syntax (synthesized nodes).
 */
const typeKinds=new Set(['IdentifierName','QualifiedName','GenericName','PredefinedType','ArrayType','NullableType','AliasQualifiedName','PointerType','TupleType','RefType']);
const squash=text=>String(text).replace(/\s+/g,'');
function findType(node,wanted){
  if(typeKinds.has(node.kind)&&squash(node.toString())===wanted)return node;
  for(const child of node.childNodes()){const found=findType(child,wanted);if(found)return found;}
  return null;
}
/** The innermost named type of a type syntax: arrays, nullable and pointer wrappers are peeled off. */
export function namedTypeSyntax(type){for(;;){if(type.kind==='ArrayType'||type.kind==='NullableType'||type.kind==='PointerType')type=type.elementType;else if(type.kind==='RefType')type=type.type;else return type;}}
/**
 * @param root the red CompilationUnit of the file  @param node a plain-AST node `{start,end}`  @param {string} typeText the type as the AST spells it
 * @returns {{start:number,end:number}|null}
 */
export function typeSyntaxSpan(root,node,typeText){
  if(!root||node?.start===undefined||node.end===undefined||node.end<=node.start)return null;
  const wanted=squash(typeText);if(!wanted)return null;
  let current;try{current=root.findNode(node.start,node.end);}catch{return null;}
  // A declarator's type lives in its parent declaration, so widen a few levels (never past a member or statement list).
  for(let depth=0;current&&depth<4;depth++,current=current.parent){
    const found=findType(current,wanted);if(found)return namedTypeSyntax(found).span;
    if(current.kind==='Block'||current.kind==='CompilationUnit'||current.kind.endsWith('Declaration')&&current.kind!=='VariableDeclaration')break;
  }
  return null;
}
