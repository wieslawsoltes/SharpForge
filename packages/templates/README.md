# @sharpforge/templates

Data-described project, solution and item templates for the supported SharpForge C#/WinUI web profile. MIT. Version 0.11.0. No DOM, filesystem or native build dependency; callers explicitly apply returned file plans.

```js
import {projectTemplates, itemTemplates, createProjectPlan, createItemPlan} from '@sharpforge/templates';
const plan = createProjectPlan('console-library-solution', {
  projectName: 'Demo', solutionName: 'DemoSuite', namespace: 'Example.Demo',
  framework: 'net10.0', checked: true
});
// plan.records: {path,text}[]; plan.folders: string[]; plan.entry/startup/openFile
// plan.modifications: {path,text,expectedText}[] when updating an existing SLNX/project
```

11 project/solution templates: console, console-async, class-library, empty-project, winui-blank, winui-navigation, winui-controls-library, test-console, blank-solution, console-library-solution, winui-library-solution.

19 item templates include classes, two-file partial classes, static/disposable classes, simple property models, WinUI page/counter/grid/settings wrappers, UserControl/custom-control/window/flyout/brush wrappers, and text/JSON/.editorconfig/Directory.Build files.

Use `searchTemplates({kind,query,category,language})` to filter the catalog (see the exported function for accepted values), `createItemPlan(id, {name,namespace,folder,projectPath,projectText,existing})` to add an item and preserve the original project XML, and `validateFilePlan(plan,existing)` for portable path/collision preflight. It does not claim a multi-file atomic filesystem transaction. File modification application must recheck `expectedText` against the current buffer or disk before writing.

Target framework names are project metadata; choosing one does not install its SDK or broaden the browser compiler. `test-console` is a deterministic assertion console, not xUnit/MSTest or Test Explorer. WinUI projects use the **code-first web profile** and composition through `.View`, not native WinUI inheritance, XAML, Windows App SDK NuGet dependencies or MSIX.

All project templates are compiled and executable templates run through source, canonical CIL, direct CIL and IL-text reassembly tests. Separate native SDK compilation is not qualified by these tests. The source distribution includes every generated project workspace and an item gallery under `examples/templates/`.
