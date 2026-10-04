/**
 * Members of a type by name. Member lookup asks a type for the members of one name far more often than for all of
 * them, and types read from metadata have hundreds (`string`, `Enumerable`, `Vector128`): the list is indexed once
 * instead of being filtered on every lookup.
 *
 * The index belongs to the type symbol (`owner._memberIndex`) and is rebuilt when the member list was replaced or
 * has grown (`addMember`), which is how a definition changes while it is being built.
 */

function buildIndex(members) {
  const byName = new Map();
  for (const member of members) {
    const list = byName.get(member.name);
    if (list) list.push(member);
    else byName.set(member.name, [member]);
  }
  return { members, count: members.length, byName };
}

/**
 * @param owner the type symbol that keeps the index  @param {object[]} members its current member list
 * @param {string} name
 * @returns {object[]} the members named `name` in declaration order; a new array the caller may keep or change
 */
export function membersNamed(owner, members, name) {
  let index = owner._memberIndex;
  if (!index || index.members !== members || index.count !== members.length) index = owner._memberIndex = buildIndex(members);
  const found = index.byName.get(name);
  return found ? found.slice() : [];
}
