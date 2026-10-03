import { definition } from '../common.js';

export const legacyItemTemplates=Object.freeze([
definition('class',
'Class',
'A public class with an editable property.',
'Code',
{
  fileName:'Class1.cs'
}
),
definition('partial-class',
'Partial Class',
'A partial class split into two source files.',
'Code',
{
  fileName:'Component1.cs'
}
),
definition('static-class',
'Static Class',
'A static utility class with a callable method.',
'Code',
{
  fileName:'Utilities.cs'
}
),
definition('disposable-class',
'Disposable Class',
'A concrete IDisposable implementation compatible with using cleanup.',
'Code',
{
  fileName:'ResourceLease.cs'
}
),
definition('view-model',
'View Model',
'A plain model with auto-properties; no unsupported binding/notification behavior is implied.',
'WinUI',
{
  fileName:'MainViewModel.cs'
}
),
definition('winui-page',
'WinUI Page',
'A code-first page component with a View property and a title.',
'WinUI',
{
  fileName:'BlankPage.cs',
  winui:true
}
),
definition('winui-counter-page',
'WinUI Counter Page',
'A stateful Page component with a live managed Click handler.',
'WinUI',
{
  fileName:'CounterPage.cs',
  winui:true
}
),
definition('winui-grid-page',
'WinUI Grid Page',
'A Page with Grid row/column definitions and attached layout properties.',
'WinUI',
{
  fileName:'GridPage.cs',
  winui:true
}
),
definition('winui-settings-page',
'WinUI Settings Page',
'A Page with native text, checkbox and managed apply action.',
'WinUI',
{
  fileName:'SettingsPage.cs',
  winui:true
}
),
definition('winui-user-control',
'WinUI User Control',
'A reusable UserControl component with a View property and a mutable caption.',
'WinUI',
{
  fileName:'CardControl.cs',
  winui:true
}
),
definition('winui-custom-control',
'WinUI Composite Control',
'A reusable Border-based control. Composition, not native templated Control inheritance.',
'WinUI',
{
  fileName:'StatusControl.cs',
  winui:true
}
),
definition('winui-window',
'WinUI Window',
'A reusable managed Window component with an Activate method.',
'WinUI',
{
  fileName:'ToolWindow.cs',
  winui:true
}
),
definition('winui-flyout',
'WinUI Menu Flyout',
'A MenuFlyout with a managed MenuFlyoutItem handler.',
'WinUI',
{
  fileName:'ActionsFlyout.cs',
  winui:true
}
),
definition('winui-resources',
'WinUI Brush Factory',
'A code-first SolidColorBrush factory. No XAML ResourceDictionary loader required.',
'WinUI',
{
  fileName:'AppBrushes.cs',
  winui:true
}
),
definition('text',
'Text File',
'An empty UTF-8 text document.',
'General',
{
  fileName:'Notes.txt',
  language:'Text'
}
),
definition('json',
'JSON File',
'An editable data-only JSON document.',
'General',
{
  fileName:'settings.json',
  language:'JSON'
}
),
definition('editorconfig',
'EditorConfig',
'Portable C# whitespace conventions.',
'Configuration',
{
  fileName:'.editorconfig',
  language:'Text'
}
),
definition('build-props',
'Directory.Build.props',
'Shared SDK properties inherited by child projects.',
'Configuration',
{
  fileName:'Directory.Build.props',
  language:'XML'
}
),
definition('build-targets',
'Directory.Build.targets',
'A source-preserving empty MSBuild import ready for authoring.',
'Configuration',
{
  fileName:'Directory.Build.targets',
  language:'XML'
}
)
]);
