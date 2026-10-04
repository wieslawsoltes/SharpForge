import {commandInventory} from './commands.js';
import {workbenchMenus} from './menus.js';
import {workbenchToolDefinitions} from './shell-tools.js';

/** Deterministic command/window inventory; workflow evidence qualifies behavior and supported targets separately. */
export function createWorkbenchInventory(registry) {
  const commands = commandInventory(registry);
  const commandIds = new Set(commands.map(command => command.id));
  return {
    format: 'sharpforge-workbench-inventory', version: 1,
    scope: 'A19 shell commands and contributed tool windows',
    qualification: 'docs/vs-workflow-matrix.md',
    commands,
    windows: workbenchToolDefinitions.map(tool => ({...tool, command: 'tool:' + tool.id,
      status: commandIds.has('tool:' + tool.id) ? 'registered' : 'unavailable'})),
    menus: workbenchMenus.map(menu => ({id: menu.id, title: menu.title, mnemonic: menu.mnemonic,
      commands: menu.commands.filter(id => commandIds.has(id))}))
  };
}
