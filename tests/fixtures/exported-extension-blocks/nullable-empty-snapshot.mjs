/** Raw nullable attribute bytes and declaration rows used to qualify scope pruning without token-number coupling. */
import { MetadataView, Table, tokenOf, ridOf, methodsOf } from './metadata.mjs';

function attributes(view, owner) {
  return view.customAttributes(owner).filter(attribute =>
    attribute.fullName === 'System.Runtime.CompilerServices.NullableAttribute' ||
    attribute.fullName === 'System.Runtime.CompilerServices.NullableContextAttribute')
    .map(attribute => ({ name: attribute.fullName, bytes: Array.from(attribute.blob) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function typeName(view, rid) {
  const names = [];
  for (let current = rid; current; current = view.nesting.enclosing.get(current)) {
    const type = view.typeDefName(current);
    names.unshift(type.name);
    if (type.namespace) names.unshift(type.namespace);
  }
  return names.join('.');
}

function generics(view, owner) {
  return view.genericParameters(owner).map(parameter => ({
    name: parameter.name,
    number: parameter.number,
    flags: parameter.flags,
    attributes: attributes(view, tokenOf(Table.GenericParam, parameter.rid)),
    constraints: view.genericConstraints(parameter.rid).map(constraint =>
      attributes(view, tokenOf(Table.GenericParamConstraint, constraint.rid))),
  }));
}

function parameters(view, method) {
  const [start, end] = view.listRange(Table.MethodDef, ridOf(method), 5, Table.Param);
  return Array.from({ length: end - start }, (_, index) => {
    const rid = start + index;
    const [flags, sequence, name] = view.row(Table.Param, rid);
    return { flags, sequence, name: view.string(name), attributes: attributes(view, tokenOf(Table.Param, rid)) };
  });
}

/** Snapshot only the control's declarations; compiler-owned fallback TypeDefs vary with the reference surface. */
export function nullableEmptyScopeSnapshot(bytes) {
  const view = new MetadataView(bytes);
  const records = [];
  for (let rid = 1; rid <= view.count(Table.TypeDef); rid++) {
    const name = typeName(view, rid);
    if (!name.startsWith('NoTransformControl.')) continue;
    const owner = tokenOf(Table.TypeDef, rid);
    records.push({ target: name, attributes: attributes(view, owner), generics: generics(view, owner) });
    const [start, end] = view.listRange(Table.TypeDef, rid, 4, Table.Field);
    for (let field = start; field < end; field++) {
      records.push({ target: name + '.' + view.string(view.row(Table.Field, field)[1]),
        attributes: attributes(view, tokenOf(Table.Field, field)) });
    }
    for (const method of methodsOf(view, owner)) {
      const methodName = view.string(view.row(Table.MethodDef, ridOf(method))[3]);
      records.push({ target: name + '.' + methodName, attributes: attributes(view, method),
        generics: generics(view, method), parameters: parameters(view, method) });
    }
  }
  return records.sort((left, right) => left.target.localeCompare(right.target));
}
