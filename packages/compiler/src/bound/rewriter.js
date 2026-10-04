/** GENERATED from bound/nodes.json by packages/compiler/scripts/generate-bound-nodes.js. Do not edit. */
import {BoundTreeVisitor} from './visitor.js';
/**
 * Rewrites a bound tree bottom-up. Each `visitX` rewrites the children and calls `node.update`, so a rewriter that
 * changes nothing returns the identical tree. Lowering passes override the `visitX` methods they care about.
 */
export class BoundTreeRewriter extends BoundTreeVisitor {
  visitList(nodes){let result=null;for(let i=0;i<nodes.length;i++){const before=nodes[i],after=this.visit(before);if(after!==before&&!result)result=nodes.slice(0,i);if(result&&after!==null&&after!==undefined)result.push(after);}return result??nodes;}
  visitDefault(node){return node;}
  visitBadExpression(node){return node.update({parts:this.visitList(node.parts)});}
  visitLiteral(node){return node;}
  visitDefaultExpression(node){return node;}
  visitLocal(node){return node;}
  visitParameter(node){return node;}
  visitThisReference(node){return node;}
  visitTypeExpression(node){return node;}
  visitFieldAccess(node){return node.update({receiver:node.receiver?this.visit(node.receiver):null});}
  visitPropertyAccess(node){return node.update({receiver:node.receiver?this.visit(node.receiver):null});}
  visitIndexerAccess(node){return node.update({receiver:this.visit(node.receiver),args:this.visitList(node.args)});}
  visitArrayAccess(node){return node.update({expression:this.visit(node.expression),index:this.visit(node.index)});}
  visitArrayLength(node){return node.update({expression:this.visit(node.expression)});}
  visitCall(node){return node.update({receiver:node.receiver?this.visit(node.receiver):null,args:this.visitList(node.args)});}
  visitObjectCreationExpression(node){return node.update({args:this.visitList(node.args),initializers:this.visitList(node.initializers),collectionInitializers:this.visitList(node.collectionInitializers)});}
  visitObjectInitializerMember(node){return node.update({value:this.visit(node.value)});}
  visitCollectionElementInitializer(node){return node.update({args:this.visitList(node.args)});}
  visitArrayCreation(node){return node.update({length:node.length?this.visit(node.length):null,initializer:this.visitList(node.initializer)});}
  visitDelegateCreationExpression(node){return node.update({receiver:node.receiver?this.visit(node.receiver):null});}
  visitUnaryOperator(node){return node.update({operand:this.visit(node.operand)});}
  visitIncrementOperator(node){return node.update({operand:this.visit(node.operand)});}
  visitBinaryOperator(node){return node.update({left:this.visit(node.left),right:this.visit(node.right)});}
  visitNullCoalescingOperator(node){return node.update({left:this.visit(node.left),right:this.visit(node.right)});}
  visitConditionalOperator(node){return node.update({condition:this.visit(node.condition),consequence:this.visit(node.consequence),alternative:this.visit(node.alternative)});}
  visitAssignmentOperator(node){return node.update({left:this.visit(node.left),right:this.visit(node.right)});}
  visitCompoundAssignmentOperator(node){return node.update({left:this.visit(node.left),right:this.visit(node.right)});}
  visitNullCoalescingAssignmentOperator(node){return node.update({left:this.visit(node.left),right:this.visit(node.right)});}
  visitEventAssignmentOperator(node){return node.update({receiver:this.visit(node.receiver),argument:this.visit(node.argument)});}
  visitConversion(node){return node.update({operand:this.visit(node.operand)});}
  visitInterpolatedString(node){return node.update({parts:this.visitList(node.parts)});}
  visitStringInsert(node){return node.update({value:this.visit(node.value)});}
  visitAwaitExpression(node){return node.update({expression:this.visit(node.expression)});}
  visitSwitchExpression(node){return node.update({expression:this.visit(node.expression),arms:this.visitList(node.arms)});}
  visitSwitchExpressionArm(node){return node.update({pattern:node.pattern?this.visit(node.pattern):null,value:this.visit(node.value)});}
  visitConstantPattern(node){return node;}
  visitCollectionExpression(node){return node.update({creation:this.visit(node.creation),elements:this.visitList(node.elements),conversion:node.conversion?this.visit(node.conversion):null});}
  visitCollectionElement(node){return node.update({value:this.visit(node.value)});}
  visitCollectionSpread(node){return node.update({statement:this.visit(node.statement)});}
  visitSequence(node){return node.update({sideEffects:this.visitList(node.sideEffects),value:this.visit(node.value)});}
  visitBadStatement(node){return node.update({parts:this.visitList(node.parts)});}
  visitNoOpStatement(node){return node;}
  visitBlock(node){return node.update({statements:this.visitList(node.statements)});}
  visitLocalDeclaration(node){return node.update({initializer:node.initializer?this.visit(node.initializer):null});}
  visitMultipleLocalDeclarations(node){return node.update({declarations:this.visitList(node.declarations)});}
  visitExpressionStatement(node){return node.update({expression:this.visit(node.expression)});}
  visitIfStatement(node){return node.update({condition:this.visit(node.condition),consequence:this.visit(node.consequence),alternative:node.alternative?this.visit(node.alternative):null});}
  visitWhileStatement(node){return node.update({condition:this.visit(node.condition),body:this.visit(node.body)});}
  visitDoStatement(node){return node.update({body:this.visit(node.body),condition:this.visit(node.condition)});}
  visitForStatement(node){return node.update({initializer:node.initializer?this.visit(node.initializer):null,condition:node.condition?this.visit(node.condition):null,body:this.visit(node.body),increment:node.increment?this.visit(node.increment):null});}
  visitForEachStatement(node){return node.update({expression:node.expression?this.visit(node.expression):null,enumerator:node.enumerator?this.visit(node.enumerator):null,body:this.visit(node.body)});}
  visitForEachEnumerator(node){return node.update({declaration:this.visit(node.declaration),moveNext:this.visit(node.moveNext),current:this.visit(node.current),dispose:this.visit(node.dispose)});}
  visitSwitchStatement(node){return node.update({expression:this.visit(node.expression),sections:this.visitList(node.sections)});}
  visitSwitchSection(node){return node.update({switchLabels:this.visitList(node.switchLabels),statements:this.visitList(node.statements)});}
  visitSwitchLabel(node){return node.update({pattern:node.pattern?this.visit(node.pattern):null});}
  visitTryStatement(node){return node.update({tryBlock:this.visit(node.tryBlock),catchBlocks:this.visitList(node.catchBlocks),finallyBlock:node.finallyBlock?this.visit(node.finallyBlock):null});}
  visitCatchBlock(node){return node.update({filter:node.filter?this.visit(node.filter):null,body:this.visit(node.body)});}
  visitUsingStatement(node){return node.update({resources:this.visitList(node.resources),body:this.visit(node.body)});}
  visitUsingResource(node){return node.update({declaration:this.visit(node.declaration),nullCheck:this.visit(node.nullCheck),dispose:this.visit(node.dispose)});}
  visitReturnStatement(node){return node.update({expression:node.expression?this.visit(node.expression):null});}
  visitThrowStatement(node){return node.update({expression:node.expression?this.visit(node.expression):null});}
  visitBreakStatement(node){return node;}
  visitContinueStatement(node){return node;}
  visitCheckedStatement(node){return node.update({body:this.visit(node.body)});}
  visitConditionalAccessAssignment(node){return node.update({receiver:this.visit(node.receiver),assignment:this.visit(node.assignment)});}
}
