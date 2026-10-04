import {resolveExecutionField} from '../field-profile.js';
import {executionFieldAccessError} from '../external-field-profile.js';

/** Keep external field policy and internal generic field resolution at the same admission boundary. */
export function verifyExecutionField(inspector, method, instruction, context, issue) {
  try {
    const field = resolveExecutionField(inspector, instruction.operand, context.typeArguments, context.methodArguments);
    const error = executionFieldAccessError(field, instruction.name);
    if (error) issue(method, instruction, 'IL_FIELD', error);
    if (field.kind !== 'field' || field.token >>> 24 !== 4 && !field.resolvedToken) {
      issue(method, instruction, 'IL_FIELD', 'External fields are inspection-only');
    }
  } catch (error) {
    issue(method, instruction, 'IL_TOKEN', error.message);
  }
}
