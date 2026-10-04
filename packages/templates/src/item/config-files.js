import { definition, joinPath, TemplateError } from '../common.js';

const definitions = [
  ['global-json', 'SDK Version Policy', 'global.json', 'JSON'],
  ['nuget-config', 'NuGet Configuration', 'nuget.config', 'XML'],
  ['gitignore-dotnet', '.NET Git Ignore', '.gitignore', 'Text'],
  ['gitattributes', 'Git Attributes', '.gitattributes', 'Text'],
  ['central-packages', 'Central Package Versions', 'Directory.Packages.props', 'XML'],
  ['dotnet-tools', 'Local .NET Tools', 'dotnet-tools.json', 'JSON'],
  ['launch-settings', 'Launch Settings', 'launchSettings.json', 'JSON'],
  ['app-manifest', 'Windows Application Manifest', 'app.manifest', 'XML'],
  ['appsettings', 'Application Settings', 'appsettings.json', 'JSON']
];

export const configFileTemplates = Object.freeze(definitions.map(([id, name, fileName, language]) =>
  definition(id, name, 'Generate ' + fileName + ' with explicit portable defaults.', 'Configuration', {
    fileName, language, kind: 'item', targets: ['data'], generate: generateConfigFile
  })));

const json = value => JSON.stringify(value, null, 2) + '\n';
const texts = {
  'nuget-config': '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n' +
    '    <clear />\n    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />\n' +
    '  </packageSources>\n</configuration>\n',
  'gitignore-dotnet': 'bin/\nobj/\n.vs/\n.vscode/\nTestResults/\n*.user\n*.suo\n*.nupkg\n*.snupkg\nartifacts/\n',
  'gitattributes': '* text=auto\n*.cs text diff=csharp\n*.sln text eol=crlf\n*.sh text eol=lf\n*.png binary\n*.jpg binary\n',
  'central-packages': '<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n' +
    '  </PropertyGroup>\n  <ItemGroup />\n</Project>\n',
  'dotnet-tools': json({ version: 1, isRoot: true, tools: {} }),
  'appsettings': json({ Logging: { LogLevel: { Default: 'Information', 'Microsoft.AspNetCore': 'Warning' } }, AllowedHosts: '*' }),
  'app-manifest': '<?xml version="1.0" encoding="utf-8"?>\n<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">\n' +
    '  <assemblyIdentity version="1.0.0.0" name="Application.app" />\n' +
    '  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>\n' +
    '    <requestedExecutionLevel level="asInvoker" uiAccess="false" />\n' +
    '  </requestedPrivileges></security></trustInfo>\n' +
    '  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>\n' +
    '    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>\n' +
    '    <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>\n' +
    '  </windowsSettings></application>\n</assembly>\n'
};

export function generateConfigFile(template, options) {
  let text = texts[template.id];
  if (template.id === 'global-json') {
    const sdkVersion = options.sdkVersion ?? '10.0.100';
    if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(sdkVersion)) throw new TemplateError('SFTPL002', 'Invalid SDK version');
    text = json({ sdk: { version: sdkVersion, rollForward: 'latestFeature', allowPrerelease: false } });
  }
  if (template.id === 'launch-settings') {
    text = json({ profiles: { [options.projectName ?? 'Application']: {
      commandName: 'Project', environmentVariables: { DOTNET_ENVIRONMENT: 'Development' }
    } } });
  }
  const subfolder = template.id === 'dotnet-tools' ? '.config' : template.id === 'launch-settings' ? 'Properties' : '';
  return { records: [{ path: joinPath(options.folder, subfolder, options.name), text }], warnings: [] };
}
