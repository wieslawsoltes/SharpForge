import {button, checkbox, element, select, input} from './ui.js';
import {defaultToolbars} from './toolbars.js';

export function customizeToolbars({dialogs, toolbars, registry}, initial = 'standard') {
  let draft = structuredClone(toolbars.rows);
  let selected = initial;
  let index = 0;
  return dialogs.open({
    title: 'Customize Toolbars',
    render(host) {
      const document = host.ownerDocument;
      const body = element(document, 'div');
      const selector = select(document, 'Toolbar', draft.map(row => ({value: row.id, label: row.title})), selected,
        value => { selected = value; index = 0; render(); });
      const commands = element(document, 'select', {size: 6, 'aria-label': 'Available commands'});
      const filter = input(document, 'Search commands', '', query => {
        commands.replaceChildren(...registry.search(query).map(command => element(document, 'option', {
          value: command.id, text: command.label
        })));
      });
      filter.dispatchEvent(new Event('input'));
      const render = () => {
        body.replaceChildren();
        const row = draft.find(item => item.id === selected);
        body.append(checkbox(document, 'Show toolbar', row.visible, value => { row.visible = value; }));
        const list = element(document, 'select', {size: 8, 'aria-label': 'Toolbar commands'});
        row.commands.forEach((id, number) => list.append(element(document, 'option', {
          value: number, text: registry.describe(id)?.label ?? id
        })));
        list.value = String(index);
        list.addEventListener('change', () => { index = Number(list.value); });
        const move = delta => {
          const target = index + delta;
          if (target < 0 || target >= row.commands.length) return;
          [row.commands[index], row.commands[target]] = [row.commands[target], row.commands[index]];
          index = target;
          render();
        };
        body.append(list, button(document, 'Move up', () => move(-1)), button(document, 'Move down', () => move(1)),
          button(document, 'Remove', () => { row.commands.splice(index, 1); render(); }),
          button(document, 'Add selected command', () => { if (commands.value) row.commands.push(commands.value); render(); }));
        body.append(button(document, 'Reset selected toolbar', () => {
          const original = defaultToolbars.find(item => item.id === selected);
          if (original) draft = draft.map(item => item.id === selected ? structuredClone(original) : item);
          index = 0;
          render();
        }));
      };
      host.append(selector, body, filter, commands);
      render();
    },
    actions: [{label: 'Apply', run: () => { toolbars.setRows(draft); return true; }}]
  });
}
