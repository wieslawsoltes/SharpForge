import { parseXml } from '@sharpforge/project-system';
import { joinPath, TemplateError } from '../common.js';
import { xamlNamespace } from './winui-xaml.js';

function resourceBody(id, key) {
  if (id === 'winui-resource-dictionary') return `  <SolidColorBrush x:Key="${key}AccentBrush" Color="#2563EB" />\n`;
  if (id === 'winui-data-template') return `  <DataTemplate x:Key="${key}">\n    <TextBlock Text="{Binding Name}" />\n  </DataTemplate>\n`;
  const template = '      <Setter.Value>\n        <ControlTemplate TargetType="Button">\n' +
    '          <Border Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">\n' +
    '            <ContentPresenter Content="{TemplateBinding Content}" />\n          </Border>\n        </ControlTemplate>\n      </Setter.Value>\n';
  return `  <Style x:Key="${key}" TargetType="Button">\n    <Setter Property="Padding" Value="12" />\n` +
    (id === 'winui-control-template' ? '    <Setter Property="Template">\n' + template + '    </Setter>\n' :
      '    <Setter Property="FontSize" Value="16" />\n') + '  </Style>\n';
}

/** Merge only a new keyed resource, preserving all unrelated dictionary source. */
export function mergeResourceDictionary(source, fragment, key) {
  const root = parseXml(source);
  if (root.name !== 'ResourceDictionary') throw new TemplateError('SFTPL003', 'Expected a ResourceDictionary');
  if (root.children.some(child => child.attributes['x:Key'] === key || child.attributes.TargetType === key)) {
    throw new TemplateError('SFTPL003', 'Duplicate resource key: ' + key);
  }
  const close = source.lastIndexOf('</ResourceDictionary>');
  if (close >= 0) return source.slice(0, close) + fragment + source.slice(close);
  const selfClose = source.lastIndexOf('/>');
  if (selfClose < 0) throw new TemplateError('SFTPL003', 'Malformed dictionary closing element');
  return source.slice(0, selfClose) + '>\n' + fragment + '</ResourceDictionary>' + source.slice(selfClose + 2);
}

export function generateControlItem(template, options) {
  const key = options.identifier;
  if (template.id !== 'winui-templated-control') {
    return { records: [{ path: joinPath(options.folder, options.name), text:
      `<ResourceDictionary ${xamlNamespace}>\n${resourceBody(template.id, key)}</ResourceDictionary>\n` }], warnings: [] };
  }
  const classPath = joinPath(options.folder, key + '.cs');
  const dictionaryPath = joinPath(options.folder, 'Themes', 'Generic.xaml');
  const style = `  <Style TargetType="local:${key}">\n    <Setter Property="Template">\n      <Setter.Value>\n` +
    `        <ControlTemplate TargetType="local:${key}">\n          <Border Background="{TemplateBinding Background}" ` +
    'Padding="{TemplateBinding Padding}" />\n        </ControlTemplate>\n      </Setter.Value>\n    </Setter>\n  </Style>\n';
  const existing = options.existing.find(file => file.path === dictionaryPath);
  const records = [{ path: classPath, text: `using Microsoft.UI.Xaml.Controls;\n\nnamespace ${options.namespace};\n\n` +
    `public sealed class ${key} : Control\n{\n    public ${key}()\n    {\n        DefaultStyleKey = typeof(${key});\n    }\n}\n` }];
  const modifications = [];
  if (existing) {
    const root = parseXml(existing.text);
    if (root.attributes['xmlns:local'] !== 'using:' + options.namespace) {
      throw new TemplateError('SFTPL003', 'Generic.xaml local namespace differs; choose the control namespace already used by the dictionary');
    }
    modifications.push({ path: dictionaryPath, expectedText: existing.text, text: mergeResourceDictionary(existing.text, style, 'local:' + key) });
  } else records.push({ path: dictionaryPath, text:
    `<ResourceDictionary ${xamlNamespace} xmlns:local="using:${options.namespace}">\n${style}</ResourceDictionary>\n` });
  return { records, modifications, warnings: ['DefaultStyleKey and Generic.xaml require the native Windows App SDK runtime.'] };
}
