import { directoryName, baseName } from '../paths.js';
import { splitList } from './errors.js';

export function fileProperties(path) {
  const name = baseName(path);
  const at = name.lastIndexOf('.');
  const directory = directoryName(path);
  return {
    msbuildthisfile: name, msbuildthisfiledirectory: '/' + (directory ? directory + '/' : ''),
    msbuildthisfilefullpath: '/' + path, msbuildthisfilename: at < 0 ? name : name.slice(0, at),
    msbuildthisfileextension: at < 0 ? '' : name.slice(at),
    msbuildthisfiledirectorynoroot: directory ? directory + '/' : '',
  };
}

export function initializeProperties(context, system, root) {
  const name = baseName(context.path);
  const at = name.lastIndexOf('.');
  const options = system.options ?? {};
  const reserved = {
    msbuildprojectfile: name, msbuildprojectextension: at < 0 ? '' : name.slice(at),
    msbuildprojectname: at < 0 ? name : name.slice(0, at), msbuildprojectdirectory: '/' + context.base,
    msbuildprojectdirectorynoroot: context.base, msbuildprojectfullpath: '/' + context.path,
    msbuildtoolsversion: root.attributes.ToolsVersion ?? 'Current', msbuildruntimetype: 'Core',
    msbuildversion: options.msbuildVersion ?? '17.0.0', msbuildsemanticversion: options.msbuildVersion ?? '17.0.0',
    msbuildstartupdirectory: '/' + (options.startupDirectory ?? ''),
    msbuildextensionspath: '/.sharpforge/msbuild', msbuildtoolspath: '/.sharpforge/msbuild',
    msbuildsdkspath: '/.sharpforge/sdk', ...fileProperties(context.path),
  };
  context.reserved = new Set(Object.keys(reserved));
  context.localProperties = new Set(splitList(root.attributes.TreatAsLocalProperty).map(value => value.toLowerCase()));
  for (const [key, value] of Object.entries(context.environment)) {
    if (/^[A-Za-z_][\w-]*$/.test(key)) context.properties[key.toLowerCase()] = String(value);
  }
  Object.assign(context.properties, { configuration: system.configuration, platform: system.platform,
    os: context.osPlatform === 'windows' ? 'Windows_NT' : 'Unix', netcoresdkversion: options.sdkVersion ?? '10.0.100' });
  const globals = { configuration: system.configuration, platform: system.platform, ...system.globalProperties,
    ...options.projectProperties?.[context.path] };
  if (system.targetFramework) globals.targetframework = system.targetFramework;
  for (const [key, value] of Object.entries(globals)) {
    context.properties[key.toLowerCase()] = String(value);
    context.globals.add(key.toLowerCase());
  }
  Object.assign(context.properties, reserved);
}
