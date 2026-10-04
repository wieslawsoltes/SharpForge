import {MethodBinderContext} from './method-context.js';
import {FrameworkQueries} from './framework-queries.js';
import {ExpressionBinder} from './expressions.js';
import {StatementBinder} from './statements.js';
import {MemoizedInference} from './inference-cache.js';
import {RegisteredFieldBinder} from './registered-fields.js';
/**
 * The method-body binder: binds one method declaration to a bound tree.
 * `new MethodBodyBinder(compilation,method).bindBody()` returns the bound body; `boundMap` maps syntax nodes to the
 * bound nodes they produced and `scopeSpans` records each local scope's source span for the semantic model.
 */
const ProfileBinder = StatementBinder(ExpressionBinder(FrameworkQueries(MemoizedInference(MethodBinderContext))));
export class MethodBodyBinder extends RegisteredFieldBinder(ProfileBinder) {}
