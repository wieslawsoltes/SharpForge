import { xmlEscape } from '@sharpforge/project-system';

export function projectXml({ name, ns, framework = 'net10.0', library = false, checked = false, winui = false, options = {} }) {
  if (!['net8.0', 'net9.0', 'net10.0', 'netstandard2.0'].includes(framework) || framework === 'netstandard2.0' && !library) {
    throw new Error('This target framework is not supported by the selected project kind');
  }
  const additions = options.langVersion ? `    <LangVersion>${options.langVersion}</LangVersion>\n` : '';
  return `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n` +
    `    <OutputType>${options.outputType ?? (library ? 'Library' : 'Exe')}</OutputType>\n` +
    `    <TargetFramework>${framework}</TargetFramework>\n` +
    `    <AssemblyName>${xmlEscape(name)}</AssemblyName>\n    <RootNamespace>${xmlEscape(ns)}</RootNamespace>\n` +
    `    <ImplicitUsings>${options.implicitUsings ? 'enable' : 'disable'}</ImplicitUsings>\n` +
    `    <Nullable>${options.nullable ?? 'disable'}</Nullable>\n    <DebugType>portable</DebugType>\n` +
    `    <CheckForOverflowUnderflow>${!!checked}</CheckForOverflowUnderflow>\n${additions}` +
    (winui ? '    <SharpForgeUIProfile>WinUIWeb</SharpForgeUIProfile>\n' : '') + '  </PropertyGroup>\n</Project>\n';
}
