import {SynchronizationBinder} from './synchronization.js';
import {MethodBinderContext} from './method-context.js';
import {FrameworkQueries} from './framework-queries.js';
import {ExpressionBinder} from './expressions.js';
import {StatementBinder} from './statements.js';
/**
 * The method-body binder: binds one method declaration to a bound tree.
 * `new MethodBodyBinder(compilation,method).bindBody()` returns the bound body; `boundMap` maps syntax nodes to the
 * bound nodes they produced and `scopeSpans` records each local scope's source span for the semantic model.
 */
export class MethodBodyBinder extends SynchronizationBinder(StatementBinder(ExpressionBinder(FrameworkQueries(MethodBinderContext)))) {}
