/** GENERATED from bound/nodes.json by packages/compiler/scripts/generate-bound-nodes.js. Do not edit. */
/**
 * Visitors over the bound tree. `BoundTreeVisitor` dispatches on node kind with every `visitX` falling back to
 * `visitDefault`; `BoundTreeWalker` visits every child in evaluation order.
 */
export class BoundTreeVisitor {
  visit(node,argument){return node?node.accept(this,argument):undefined;}
  visitDefault(node,argument){return undefined;}
  visitBadExpression(node,argument){return this.visitDefault(node,argument);}
  visitLiteral(node,argument){return this.visitDefault(node,argument);}
  visitDefaultExpression(node,argument){return this.visitDefault(node,argument);}
  visitLocal(node,argument){return this.visitDefault(node,argument);}
  visitParameter(node,argument){return this.visitDefault(node,argument);}
  visitThisReference(node,argument){return this.visitDefault(node,argument);}
  visitTypeExpression(node,argument){return this.visitDefault(node,argument);}
  visitFieldAccess(node,argument){return this.visitDefault(node,argument);}
  visitPropertyAccess(node,argument){return this.visitDefault(node,argument);}
  visitIndexerAccess(node,argument){return this.visitDefault(node,argument);}
  visitArrayAccess(node,argument){return this.visitDefault(node,argument);}
  visitArrayLength(node,argument){return this.visitDefault(node,argument);}
  visitCall(node,argument){return this.visitDefault(node,argument);}
  visitObjectCreationExpression(node,argument){return this.visitDefault(node,argument);}
  visitObjectInitializerMember(node,argument){return this.visitDefault(node,argument);}
  visitCollectionElementInitializer(node,argument){return this.visitDefault(node,argument);}
  visitArrayCreation(node,argument){return this.visitDefault(node,argument);}
  visitDelegateCreationExpression(node,argument){return this.visitDefault(node,argument);}
  visitUnaryOperator(node,argument){return this.visitDefault(node,argument);}
  visitIncrementOperator(node,argument){return this.visitDefault(node,argument);}
  visitBinaryOperator(node,argument){return this.visitDefault(node,argument);}
  visitNullCoalescingOperator(node,argument){return this.visitDefault(node,argument);}
  visitConditionalOperator(node,argument){return this.visitDefault(node,argument);}
  visitAssignmentOperator(node,argument){return this.visitDefault(node,argument);}
  visitCompoundAssignmentOperator(node,argument){return this.visitDefault(node,argument);}
  visitNullCoalescingAssignmentOperator(node,argument){return this.visitDefault(node,argument);}
  visitEventAssignmentOperator(node,argument){return this.visitDefault(node,argument);}
  visitConversion(node,argument){return this.visitDefault(node,argument);}
  visitInterpolatedString(node,argument){return this.visitDefault(node,argument);}
  visitStringInsert(node,argument){return this.visitDefault(node,argument);}
  visitAwaitExpression(node,argument){return this.visitDefault(node,argument);}
  visitSwitchExpression(node,argument){return this.visitDefault(node,argument);}
  visitSwitchExpressionArm(node,argument){return this.visitDefault(node,argument);}
  visitConstantPattern(node,argument){return this.visitDefault(node,argument);}
  visitCollectionExpression(node,argument){return this.visitDefault(node,argument);}
  visitCollectionElement(node,argument){return this.visitDefault(node,argument);}
  visitCollectionSpread(node,argument){return this.visitDefault(node,argument);}
  visitSequence(node,argument){return this.visitDefault(node,argument);}
  visitBadStatement(node,argument){return this.visitDefault(node,argument);}
  visitNoOpStatement(node,argument){return this.visitDefault(node,argument);}
  visitBlock(node,argument){return this.visitDefault(node,argument);}
  visitLocalDeclaration(node,argument){return this.visitDefault(node,argument);}
  visitMultipleLocalDeclarations(node,argument){return this.visitDefault(node,argument);}
  visitExpressionStatement(node,argument){return this.visitDefault(node,argument);}
  visitIfStatement(node,argument){return this.visitDefault(node,argument);}
  visitWhileStatement(node,argument){return this.visitDefault(node,argument);}
  visitDoStatement(node,argument){return this.visitDefault(node,argument);}
  visitForStatement(node,argument){return this.visitDefault(node,argument);}
  visitForEachStatement(node,argument){return this.visitDefault(node,argument);}
  visitForEachEnumerator(node,argument){return this.visitDefault(node,argument);}
  visitSwitchStatement(node,argument){return this.visitDefault(node,argument);}
  visitSwitchSection(node,argument){return this.visitDefault(node,argument);}
  visitSwitchLabel(node,argument){return this.visitDefault(node,argument);}
  visitTryStatement(node,argument){return this.visitDefault(node,argument);}
  visitCatchBlock(node,argument){return this.visitDefault(node,argument);}
  visitUsingStatement(node,argument){return this.visitDefault(node,argument);}
  visitUsingResource(node,argument){return this.visitDefault(node,argument);}
  visitReturnStatement(node,argument){return this.visitDefault(node,argument);}
  visitThrowStatement(node,argument){return this.visitDefault(node,argument);}
  visitBreakStatement(node,argument){return this.visitDefault(node,argument);}
  visitContinueStatement(node,argument){return this.visitDefault(node,argument);}
  visitCheckedStatement(node,argument){return this.visitDefault(node,argument);}
  visitConditionalAccessAssignment(node,argument){return this.visitDefault(node,argument);}
}
export class BoundTreeWalker extends BoundTreeVisitor {
  visitList(nodes,argument){for(const node of nodes)this.visit(node,argument);}
  visitDefault(node,argument){this.visitList(node.children,argument);return undefined;}
}
