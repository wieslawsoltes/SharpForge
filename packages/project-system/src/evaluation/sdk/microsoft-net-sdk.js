import { parseTargetFramework, targetFrameworkDefines } from '../../tfm.js';
import { splitList, toBoolean } from '../errors.js';
import { installSdkBuildTargets } from './build-targets.js';

function appendProperty(context, name, values) {
  if (context.globals.has(name) && !context.localProperties.has(name)) return;
  context.properties[name] = [...new Set([...splitList(context.properties[name]), ...values])].join(';');
}

export function defaultProperty(context, name, value) {
  const key = name.toLowerCase();
  if (context.properties[key] === undefined || context.properties[key] === '') context.properties[key] = String(value);
}

export function netSdkProps(context) {
  for (const [name, value] of Object.entries({
    UsingMicrosoftNETSdk: true, UsingNETSdkDefaults: true, Configuration: 'Debug', Platform: 'AnyCPU',
    EnableDefaultItems: true, EnableDefaultCompileItems: true, EnableDefaultEmbeddedResourceItems: true,
    EnableDefaultNoneItems: true, OutputType: 'Library', BaseOutputPath: 'bin/', BaseIntermediateOutputPath: 'obj/',
    Deterministic: true, GenerateAssemblyInfo: true, GenerateTargetFrameworkAttribute: true,
    ImportDirectoryBuildProps: true, ImportDirectoryBuildTargets: true,
    NoWarn: '1701;1702',
  })) defaultProperty(context, name, value);
  appendProperty(context, 'defineconstants', ['TRACE']);
  appendProperty(context, 'warningsaserrors', ['NU1605']);
}

export function netSdkTargets(context) {
  const properties = context.properties;
  const framework = parseTargetFramework(properties.targetframework);
  const major = Number(framework.version.split('.')[0]);
  const language = framework.identifier === '.NETCoreApp' && major >= 5 ? String(major + 4) + '.0'
    : framework.identifier === '.NETCoreApp' && major >= 3 ? '8.0'
      : framework.identifier === '.NETStandard' && framework.version === '2.1' ? '8.0' : '7.3';
  const configuration = properties.configuration;
  for (const [name, value] of Object.entries({
    AssemblyName: properties.msbuildprojectname, RootNamespace: properties.msbuildprojectname.replaceAll(' ', '_'),
    TargetFrameworkIdentifier: framework.identifier, TargetFrameworkVersion: framework.version ? 'v' + framework.version : '',
    TargetPlatformIdentifier: framework.platform, TargetPlatformVersion: framework.platformVersion,
    LangVersion: framework.supported ? language : '14', Nullable: '', AllowUnsafeBlocks: false,
    CheckForOverflowUnderflow: false, WarningLevel: major >= 5 ? String(major) : '4', TreatWarningsAsErrors: false,
    Optimize: configuration.toLowerCase() === 'release', DebugSymbols: true, DebugType: 'portable',
    AppendTargetFrameworkToOutputPath: true, AppendRuntimeIdentifierToOutputPath: true,
    Version: properties.versionprefix ? properties.versionprefix + (properties.versionsuffix ? '-' + properties.versionsuffix : '') : '1.0.0',
    VersionPrefix: '1.0.0', TargetExt: '.dll', FileAlignment: 512,
  })) defaultProperty(context, name, value);
  const tfmDirectory = properties.targetframework && toBoolean(properties.appendtargetframeworktooutputpath, true)
    ? properties.targetframework + '/' : '';
  const ridDirectory = properties.runtimeidentifier && toBoolean(properties.appendruntimeidentifiertooutputpath, true)
    ? properties.runtimeidentifier + '/' : '';
  defaultProperty(context, 'OutputPath', properties.baseoutputpath + configuration + '/' + tfmDirectory + ridDirectory);
  defaultProperty(context, 'IntermediateOutputPath', properties.baseintermediateoutputpath + configuration + '/' + tfmDirectory + ridDirectory);
  defaultProperty(context, 'MSBuildProjectExtensionsPath', properties.baseintermediateoutputpath);
  defaultProperty(context, 'TargetName', properties.assemblyname);
  defaultProperty(context, 'TargetFileName', properties.targetname + properties.targetext);
  defaultProperty(context, 'TargetPath', '/' + context.resolvePath(properties.outputpath + properties.targetfilename));
  defaultProperty(context, 'AssemblyVersion', properties.version.split('-')[0].split('.').slice(0, 3).join('.') + '.0');
  defaultProperty(context, 'FileVersion', properties.assemblyversion);
  defaultProperty(context, 'InformationalVersion', properties.version);
  defaultProperty(context, 'DefaultItemExcludes', properties.baseoutputpath + '**;' + properties.baseintermediateoutputpath + '**;**/.*;**/.*/**');
  const defines = [];
  if (!toBoolean(properties.disableimplicitconfigurationdefines)) defines.push(configuration.toUpperCase().replace(/[-. ]/g, '_'));
  if (!toBoolean(properties.disableimplicitframeworkdefines)) defines.push(...targetFrameworkDefines(framework));
  appendProperty(context, 'defineconstants', defines);
  if (framework.identifier === '.NETCoreApp' && major >= 7 && !toBoolean(properties.enableunsafebinaryformatterserialization)) {
    appendProperty(context, 'warningsaserrors', ['SYSLIB0011']);
  }
  installSdkBuildTargets(context);
}

export function netSdkDefaultItems(context) {
  const properties = context.properties;
  if (!toBoolean(properties.enabledefaultitems, true)) return [];
  const prefix = context.base ? context.base + '/' : '';
  const excludes = splitList(properties.defaultitemexcludes).map(value => context.resolvePath(value));
  excludes.push(prefix + '**/bin/**', prefix + '**/obj/**', prefix + '**/.*', prefix + '**/.*/**');
  const files = context.pathIndex.glob(prefix + '**/*', excludes);
  const items = [];
  for (const path of files) {
    const identity = path.slice(prefix.length);
    let itemType = 'None';
    if (/\.cs$/i.test(path) && toBoolean(properties.enabledefaultcompileitems, true)) itemType = 'Compile';
    else if (/\.resx$/i.test(path) && toBoolean(properties.enabledefaultembeddedresourceitems, true)) itemType = 'EmbeddedResource';
    else if (!toBoolean(properties.enabledefaultnoneitems, true) || /\.(?:csproj|vbproj|fsproj|sln|slnx)$/i.test(path)) continue;
    items.push({ itemType, identity, path, metadata: { ...context.definitions[itemType] }, definingProject: context.path, implicit: true });
  }
  if (['enable', 'true'].includes(String(properties.implicitusings).toLowerCase())) {
    const usings = ['System', 'System.Collections.Generic', 'System.IO', 'System.Linq', 'System.Net.Http',
      'System.Threading', 'System.Threading.Tasks'];
    if (toBoolean(properties.usingmicrosoftnetsdkweb)) usings.push('Microsoft.AspNetCore.Builder', 'Microsoft.AspNetCore.Hosting',
      'Microsoft.AspNetCore.Http', 'Microsoft.AspNetCore.Routing', 'Microsoft.Extensions.Configuration',
      'Microsoft.Extensions.DependencyInjection', 'Microsoft.Extensions.Hosting', 'Microsoft.Extensions.Logging');
    for (const identity of usings) items.push({ itemType: 'Using', identity, metadata: {}, definingProject: context.path, implicit: true });
  }
  return items;
}

export const microsoftNetSdk = Object.freeze({ name: 'Microsoft.NET.Sdk', props: netSdkProps, targets: netSdkTargets, items: netSdkDefaultItems });
