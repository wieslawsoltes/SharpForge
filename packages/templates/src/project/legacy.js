import { joinPath } from '../common.js';
import { projectXml } from './project-xml.js';
import { consoleSource, navigationSource, winuiProgramSource, legacyReadme } from './legacy-content.js';

export function emitLegacyProject(id, options, createItemPlan) {
  const { name, ns, folder } = options;
  const records = [];
  const library = ['class-library', 'empty-project', 'winui-controls-library'].includes(id);
  const winui = id.startsWith('winui');
  const put = (path, text) => records.push({ path: joinPath(folder, path), text });
  put(name + '.csproj', projectXml({ ...options, library, winui }));
  const item = (template, className, subfolder = '') => {
    const plan = createItemPlan(template, { name: className + '.cs', namespace: ns, folder: joinPath(folder, subfolder) });
    records.push(...plan.records);
  };
  let openFile;
  if (['console', 'console-async', 'test-console'].includes(id)) {
    put('Program.cs', consoleSource(id, ns));
    openFile = joinPath(folder, 'Program.cs');
  } else if (id === 'class-library') {
    item('static-class', 'Calculator');
    openFile = joinPath(folder, 'Calculator.cs');
  } else if (id === 'winui-controls-library') {
    item('winui-user-control', 'CardControl');
    openFile = joinPath(folder, 'CardControl.cs');
  } else if (winui) {
    item(id === 'winui-navigation' ? 'winui-page' : 'winui-counter-page', 'MainPage', 'Pages');
    if (id === 'winui-navigation') {
      item('winui-settings-page', 'SettingsPage', 'Pages');
      put('Shell.cs', navigationSource(ns));
    }
    put('Program.cs', winuiProgramSource(options, id === 'winui-navigation'));
    openFile = joinPath(folder, 'Program.cs');
  }
  put('README.md', legacyReadme(name, library, winui));
  return {
    records, folders: winui ? [joinPath(folder, 'Assets')] : [], projectPath: joinPath(folder, name + '.csproj'),
    openFile: openFile ?? joinPath(folder, name + '.csproj'), library, winui
  };
}
