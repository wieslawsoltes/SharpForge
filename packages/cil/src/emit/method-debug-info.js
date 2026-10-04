import {memberAccessNames} from '../metadata/member-definitions.js';

/** Debug accessors describe emitted MethodDef flags, including an explicit member metadata override. */
export function emissionMethodDebugInfo(descriptor, body) {
  const method = descriptor.original;
  const accessor = method.accessor
    ? {...method.accessor, access: memberAccessNames.get(descriptor.flags & 7)} : null;
  return {
    ...(method.asyncRole ? {asyncRole: method.asyncRole, asyncOrigin: method.asyncOrigin} : {}),
    id: method.id, token: descriptor.token, name: method.name, qualifiedName: method.qualifiedName,
    ...(method.sourceRange ? {sourceRange: method.sourceRange} : {}),
    ...(accessor ? {accessor} : {}),
    locals: method.locals.map(({type, ...local}) => local), spans: body.spans,
  };
}
