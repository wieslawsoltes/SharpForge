import { definition } from '../common.js';

export const legacyProjectTemplates=Object.freeze([
definition('console',
'Console App',
'An explicit Main entry point with console output and a portable SDK project.',
'Console',
{
  icon:'>_',
  nativeCompatible:true
}
),
definition('console-async',
'Console App (async)',
'An async Task Main entry point and managed Task.Delay example.',
'Console',
{
  icon:'>_',
  nativeCompatible:true
}
),
definition('class-library',
'Class Library',
'A reusable public C# class library with no entry point.',
'Library',
{
  icon:'◇',
  nativeCompatible:true
}
),
definition('empty-project',
'Empty C# Project',
'A library project with no source files; add items as needed.',
'Library',
{
  icon:'◇',
  nativeCompatible:true
}
),
definition('winui-blank',
'WinUI App (code-first web)',
'A managed window, reusable page component and working counter event. HTML controls with graphics fallbacks.',
'WinUI',
{
  icon:'▣',
  winui:true
}
),
definition('winui-navigation',
'WinUI Navigation App',
'Home and Settings page components with managed navigation buttons, no XAML.',
'WinUI',
{
  icon:'▣',
  winui:true
}
),
definition('winui-controls-library',
'WinUI Control Library',
'A reusable code-first UserControl component exposed through its View property.',
'WinUI',
{
  icon:'◈',
  winui:true
}
),
definition('test-console',
'Self-test Console',
'Package-free assertions and process failure on an incorrect result. Not an xUnit/MSTest runner.',
'Tests',
{
  icon:'✓',
  nativeCompatible:true
}
),
definition('blank-solution',
'Blank Solution',
'An empty .slnx solution with solution folders; add existing or new projects.',
'Solution',
{
  icon:'◇',
  kind:'solution'
}
),
definition('console-library-solution',
'Console + Library Solution',
'Two separate SDK projects and a ProjectReference, with the console selected as startup.',
'Solution',
{
  icon:'◇',
  kind:'solution',
  nativeCompatible:true
}
),
definition('winui-library-solution',
'WinUI App + Control Library',
'A code-first WinUI app consuming a component from a second project.',
'Solution',
{
  icon:'◇',
  kind:'solution',
  winui:true
}
)
]);
