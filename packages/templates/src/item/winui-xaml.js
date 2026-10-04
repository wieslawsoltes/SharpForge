import { joinPath } from '../common.js';

export const xamlNamespace = 'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" ' +
  'xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"';
export const nativeXamlOptions = Object.freeze({
  kind: 'item', language: 'XAML', windowsOnly: true, nativeOnly: true, platform: 'Windows', targets: ['windows-native'],
  prerequisites: ['Windows App SDK XAML compiler'], qualification: { 'windows-native': 'pending' }
});

export function xamlPair({ name, namespace, folder, rootType, body = '', attributes = '' }) {
  const xamlPath = joinPath(folder, name + '.xaml');
  const usings = 'using Microsoft.UI.Xaml;\nusing Microsoft.UI.Xaml.Controls;\n';
  const code = `${usings}\nnamespace ${namespace};\n\npublic sealed partial class ${name} : ${rootType}\n{\n` +
    `    public ${name}()\n    {\n        InitializeComponent();\n    }\n}\n`;
  return {
    records: [
      { path: xamlPath, text: `<${rootType} x:Class="${namespace}.${name}" ${xamlNamespace}${attributes ? ' ' + attributes : ''}>\n${body}</${rootType}>\n` },
      { path: xamlPath + '.cs', text: code }
    ],
    membership: [
      { path: xamlPath, itemType: 'Page', metadata: { Generator: 'MSBuild:Compile' } },
      { path: xamlPath + '.cs', itemType: 'Compile', metadata: { DependentUpon: name + '.xaml' } }
    ], warnings: ['Native compilation requires the Windows App SDK XAML compiler; the browser designer synchronizes the generated literal XAML.']
  };
}

export function generateXamlItem(template, options) {
  const name = options.identifier;
  const body = '  <Grid>\n    <TextBlock Text="' + name + '" HorizontalAlignment="Center" VerticalAlignment="Center" />\n  </Grid>\n';
  return xamlPair({ ...options, name, rootType: template.xamlType, body,
    attributes: template.xamlType === 'ContentDialog' ? 'Title="Dialog" PrimaryButtonText="OK" CloseButtonText="Cancel"' : '' });
}
