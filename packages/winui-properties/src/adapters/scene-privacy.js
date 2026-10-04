/** Password payloads use an explicit ephemeral channel, never the shared scene protocol. */
export function isPrivateUIProperty(type, property) {
  return (type === 'PasswordBox' || type?.endsWith('.PasswordBox')) && (property === 'Password' || property === 'SelectedText');
}

export function publicUIProperties(type, properties) {
  const result = {};
  for (const [name, value] of Object.entries(properties)) {
    if (!isPrivateUIProperty(type, name)) result[name] = value;
  }
  if (isPrivateUIProperty(type, 'Password')) result.PasswordRedacted = true;
  return result;
}

/** Return a safe command plus private updates for delivery on the caller's private channel. */
export function prepareUICommand(command, typeForId) {
  const privateValues = [];
  const redact = (type, id, properties) => {
    for (const [name, value] of Object.entries(properties)) {
      if (isPrivateUIProperty(type, name)) privateValues.push({id, property: name, value});
    }
    return publicUIProperties(type, properties);
  };
  if (command.op === 'set' && isPrivateUIProperty(typeForId(command.id), command.property)) {
    privateValues.push({id: command.id, property: command.property, value: command.value});
    return {command: null, privateValues};
  }
  if (command.op === 'create') {
    return {command: {...command, properties: redact(command.type, command.id, command.properties ?? {})}, privateValues};
  }
  if (command.snapshot?.nodes) {
    const nodes = command.snapshot.nodes.map(node => ({...node, properties: redact(node.type, node.id, node.properties ?? {})}));
    return {command: {...command, snapshot: {...command.snapshot, nodes}}, privateValues};
  }
  return {command, privateValues};
}
