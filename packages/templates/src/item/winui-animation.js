import { joinPath, wrapNamespace } from '../common.js';
import { xamlNamespace, xamlPair } from './winui-xaml.js';

export function generateAnimationItem(template, options) {
  if (template.id === 'winui-storyboard-code') {
    const body = `public static class ${options.identifier}\n{\n    public static Storyboard Create(UIElement target)\n    {\n` +
      '        DoubleAnimation fade = new DoubleAnimation();\n        fade.From = 0;\n        fade.To = 1;\n' +
      '        fade.Duration = new Duration(TimeSpan.FromMilliseconds(200));\n' +
      '        Storyboard.SetTarget(fade, target);\n        Storyboard.SetTargetProperty(fade, "Opacity");\n' +
      '        Storyboard storyboard = new Storyboard();\n        storyboard.Children.Add(fade);\n        return storyboard;\n    }\n}';
    const usings = 'using System;\nusing Microsoft.UI.Xaml;\nusing Microsoft.UI.Xaml.Media.Animation;\n';
    return { records: [{ path: joinPath(options.folder, options.name), text: wrapNamespace(options.namespace, body, usings) }], warnings: [] };
  }
  const animation = '<DoubleAnimation Storyboard.TargetName="AnimatedElement" Storyboard.TargetProperty="Opacity" From="0" To="1" Duration="0:0:0.2" />';
  let text;
  if (template.id === 'winui-storyboard-xaml') text = `<ResourceDictionary ${xamlNamespace}>\n` +
    `  <Storyboard x:Key="${options.identifier}">\n    ${animation}\n  </Storyboard>\n</ResourceDictionary>\n`;
  if (template.id === 'winui-theme-transition') text = '  <Grid>\n' +
    '    <Grid.ChildrenTransitions><TransitionCollection><EntranceThemeTransition /></TransitionCollection></Grid.ChildrenTransitions>\n' +
    '    <TextBlock x:Name="AnimatedElement" Text="Welcome" />\n  </Grid>\n';
  if (template.id === 'winui-visual-states') text = '  <Grid>\n' +
    '    <VisualStateManager.VisualStateGroups><VisualStateGroup x:Name="DisplayStates">\n' +
    '      <VisualState x:Name="Hidden"><VisualState.Setters><Setter Target="AnimatedElement.Opacity" Value="0" /></VisualState.Setters></VisualState>\n' +
    '      <VisualState x:Name="Visible"><Storyboard>' + animation + '</Storyboard></VisualState>\n' +
    '    </VisualStateGroup></VisualStateManager.VisualStateGroups>\n' +
    '    <TextBlock x:Name="AnimatedElement" Text="Animated content" />\n  </Grid>\n';
  if (template.id !== 'winui-storyboard-xaml') {
    const pair = xamlPair({ ...options, name: options.identifier, rootType: 'Page', body: text });
    return { ...pair, warnings: ['XAML transitions and visual states require native Windows App SDK qualification.'] };
  }
  return { records: [{ path: joinPath(options.folder, options.name), text }], warnings: [
    'Load the storyboard in a native view namescope containing AnimatedElement before Begin().'
  ] };
}
