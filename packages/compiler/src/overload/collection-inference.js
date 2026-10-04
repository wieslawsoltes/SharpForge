/**
 * Collection-expression inputs for method inference (C# 12, collection-expressions, "Type inference").
 *
 * A collection expression contributes its expression elements recursively, each against the target's element
 * type. A spread contributes its iteration type as a lower bound, with no output inference. Flattening that tree
 * once makes the existing two-phase algorithm see lambda/method-group dependencies at every collection depth.
 * The binder supplies `collectionTarget(type)` and each spread's `iterationType`; no syntax is rebound here.
 */
import { stripNullable } from '../conversions/nullable.js';

/**
 * Expands collection arguments to aligned leaf arguments and parameter types, or null when no expansion is needed.
 * Runs in O(arguments + collection elements), with an explicit stack bounded by the collection nesting depth.
 * An empty expression or a target without an element type contributes no bounds and never acquires a natural type.
 */
export function collectionInferenceArguments(parameterTypes, args) {
  if (!args.some(argument => argument.form === 'collection')) return null;
  const flattenedArgs = [];
  const flattenedTypes = [];
  const pending = [{ elements: args, parameterTypes, elementType: null, collection: false, index: 0 }];
  while (pending.length) {
    const frame = pending.at(-1);
    if (frame.index === frame.elements.length) {
      pending.pop();
      continue;
    }
    const index = frame.index++;
    const element = frame.elements[index];
    const parameterType = frame.collection ? frame.elementType : frame.parameterTypes[index];
    if (!parameterType) continue;
    if (frame.collection && element.spread) {
      if (element.iterationType) {
        flattenedArgs.push({ type: element.iterationType });
        flattenedTypes.push(parameterType);
      }
      continue;
    }
    const argument = frame.collection ? element.value : element;
    if (argument.form !== 'collection') {
      flattenedArgs.push(argument);
      flattenedTypes.push(parameterType);
      continue;
    }
    const elementType = argument.collectionTarget?.(stripNullable(parameterType))?.elementType;
    if (!elementType) continue;
    pending.push({ elements: argument.elements, parameterTypes: null, elementType, collection: true, index: 0 });
  }
  return { args: flattenedArgs, parameterTypes: flattenedTypes };
}
