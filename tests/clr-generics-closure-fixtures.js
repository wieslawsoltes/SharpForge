import { genericFixture, generic, variable, primitive, openGenerics } from './clr-generics-instantiation-fixtures.js';

export function decorateClosure(pattern) {
  return ({ type, base, contract, tokens }) => {
    tokens.subject = type('Subject`2', 2);
    tokens.partner = type('Partner`2', 2);
    const subject = arguments_ => generic(tokens.subject, arguments_);
    const partner = arguments_ => generic(tokens.partner, arguments_);
    const box = argument => generic(tokens.box, [argument]);
    const parameters = [variable(), variable(1)];
    if (pattern === 'simple') base(tokens.subject, box(subject(parameters)), 'subjectBase');
    if (pattern === 'permuted' || pattern === 'indirect-expanding') {
      base(tokens.subject, box(partner([variable(1), variable()])), 'subjectBase');
      const first = pattern === 'permuted' ? variable() : box(variable());
      base(tokens.partner, box(subject([first, variable(1)])), 'partnerBase');
    }
    if (pattern === 'array-expanding') {
      base(tokens.subject, box(subject([{ kind: 'szarray', element: variable() }, variable(1)])), 'subjectBase');
    }
    if (pattern === 'acyclic-expansion') {
      base(tokens.subject, box(partner([box(variable()), variable(1)])), 'subjectBase');
    }
    if (pattern === 'erased-cycle') {
      base(tokens.subject, partner([primitive('int'), primitive('string')]), 'subjectBase');
      base(tokens.partner, subject([primitive('int'), primitive('string')]), 'partnerBase');
    }
    if (pattern === 'non-generic-self-interface') {
      tokens.plain = type('Plain');
      contract(tokens.plain, generic(tokens.contract, [{ kind: 'class', token: tokens.plain }]), 'plainContract');
    }
  };
}

export function openClosure(pattern, options = {}) {
  return openGenerics(options, { decorate: decorateClosure(pattern) });
}

export function remoteClosure(name, target, { expanding = false, delay = false } = {}) {
  return genericFixture({ name, decorate({ md, type, base, tokens }) {
    tokens.subject = type('Subject`1', 1);
    md.referenceIdentities.set(target.toLowerCase(), { name: target, version: [0, 2, 0, 0],
      culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
    const reference = md.typeRef(delay ? 'Fixture.Box`1' : 'Fixture.Subject`1', target);
    const argument = expanding ? { kind: 'szarray', element: variable() } : variable();
    base(tokens.subject, generic(tokens.box, [generic(reference, [argument])]), 'subjectBase');
  } });
}
