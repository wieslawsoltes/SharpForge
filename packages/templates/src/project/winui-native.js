import { xmlEscape } from '@sharpforge/project-system';
import { joinPath, TemplateError } from '../common.js';
import { templateLogo } from './assets.js';
import { packageReferences, testPackages } from './tests.js';
import { winuiTestApplication, winuiTestSource } from './winui-test-host.js';
import { xamlPair } from '../item/winui-xaml.js';

export const windowsAppSdkVersion = '1.8.260921001';

function projectSource(template, options) {
  const library = template.id === 'winui-native-library';
  const testApplication = template.id === 'winui-native-tests';
  const packaged = template.id === 'winui-native-packaged';
  const framework = options.framework;
  if (framework.startsWith('netstandard')) throw new TemplateError('SFTPL002', 'WinUI requires a .NET Windows target, not .NET Standard');
  let text = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
    `    <TargetFramework>${framework}-windows10.0.19041.0</TargetFramework>\n` +
    `    <OutputType>${library ? 'Library' : testApplication ? 'Exe' : 'WinExe'}</OutputType>\n` +
    `    <RootNamespace>${xmlEscape(options.ns)}</RootNamespace>\n` +
    '    <UseWinUI>true</UseWinUI>\n' +
    `    <Nullable>${options.options.nullable}</Nullable>\n` +
    `    <ImplicitUsings>${options.options.implicitUsings ? 'enable' : 'disable'}</ImplicitUsings>\n` +
    '    <Platforms>x86;x64;ARM64</Platforms>\n    <RuntimeIdentifiers>win-x86;win-x64;win-arm64</RuntimeIdentifiers>\n' +
    '    <SupportedOSPlatformVersion>10.0.17763.0</SupportedOSPlatformVersion>\n';
  if (!library) text += '    <ApplicationManifest>app.manifest</ApplicationManifest>\n';
  if (options.options.langVersion) text += `    <LangVersion>${options.options.langVersion}</LangVersion>\n`;
  text += packaged ? '    <EnableMsixTooling>true</EnableMsixTooling>\n    <AppxPackageSigningEnabled>false</AppxPackageSigningEnabled>\n' :
    '    <WindowsPackageType>None</WindowsPackageType>\n';
  if (testApplication) text += '    <IsTestProject>true</IsTestProject>\n    <IsPackable>false</IsPackable>\n' +
    '    <EnableMSTestRunner>true</EnableMSTestRunner>\n    <GenerateTestingPlatformEntryPoint>false</GenerateTestingPlatformEntryPoint>\n' +
    '    <GenerateProgramFile>false</GenerateProgramFile>\n    <WindowsAppSDKSelfContained>true</WindowsAppSDKSelfContained>\n';
  text += '  </PropertyGroup>\n' + packageReferences([['Microsoft.WindowsAppSDK', windowsAppSdkVersion]]) +
    (testApplication ? packageReferences(testPackages.mstest.filter(([name]) => name !== 'Microsoft.NET.Test.Sdk')) : '');
  if (testApplication) text += '  <ItemGroup>\n    <ProjectCapability Include="TestContainer" />\n  </ItemGroup>\n';
  if (packaged) text += '  <ItemGroup>\n    <Content Include="Assets\\*.png" />\n  </ItemGroup>\n';
  return text + '</Project>\n';
}

function packageManifest(name) {
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" ' +
    'xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" ' +
    'xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">\n' +
    `  <Identity Name="${xmlEscape(name)}" Publisher="CN=SharpForge" Version="1.0.0.0" />\n` +
    `  <Properties><DisplayName>${xmlEscape(name)}</DisplayName><PublisherDisplayName>SharpForge</PublisherDisplayName>` +
    '<Logo>Assets\\StoreLogo.png</Logo></Properties>\n' +
    '  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" /></Dependencies>\n' +
    '  <Resources><Resource Language="en-us" /></Resources>\n' +
    '  <Applications><Application Id="App" Executable="$targetnametoken$.exe" EntryPoint="$targetentrypoint$">\n' +
    `    <uap:VisualElements DisplayName="${xmlEscape(name)}" Description="${xmlEscape(name)}" BackgroundColor="transparent" ` +
    'Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png">\n' +
    '      <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" />\n' +
    '    </uap:VisualElements>\n  </Application></Applications>\n' +
    '  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>\n</Package>\n';
}

export function generateNativeWinui(template, options) {
  const { name, ns, folder } = options;
  const records = [];
  const put = (path, text) => records.push({ path: joinPath(folder, path), text });
  put(name + '.csproj', projectSource(template, options));
  const library = template.id === 'winui-native-library';
  if (library) {
    put('Class1.cs', `namespace ${ns};\n\npublic class Class1\n{\n    public int Value { get; set; }\n}\n`);
    records.push(...xamlPair({ name: 'SampleControl', namespace: ns, folder, rootType: 'UserControl',
      body: '  <Grid><TextBlock Text="Library control" /></Grid>\n' }).records);
  } else {
    put('App.xaml', `<Application x:Class="${ns}.App" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" ` +
      'xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Application.Resources>\n' +
      '  <ResourceDictionary><ResourceDictionary.MergedDictionaries><XamlControlsResources ' +
      'xmlns="using:Microsoft.UI.Xaml.Controls" /></ResourceDictionary.MergedDictionaries></ResourceDictionary>\n' +
      '</Application.Resources></Application>\n');
    put('App.xaml.cs', `using Microsoft.UI.Xaml;\n\nnamespace ${ns};\n\npublic partial class App : Application\n{\n` +
      '    private Window? window;\n    public App() { InitializeComponent(); }\n' +
      '    protected override void OnLaunched(LaunchActivatedEventArgs args)\n    {\n' +
      '        window = new MainWindow();\n        window.Activate();\n    }\n}\n');
    put('MainWindow.xaml', `<Window x:Class="${ns}.MainWindow" Title="${xmlEscape(name)}" ` +
      'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">\n' +
      '  <StackPanel HorizontalAlignment="Center" VerticalAlignment="Center" Spacing="12">\n' +
      '    <TextBlock x:Name="CounterText" Text="Count: 0" FontSize="28" />\n' +
      '    <Button Content="Increment" Click="Increment" />\n  </StackPanel>\n</Window>\n');
    put('MainWindow.xaml.cs', `using Microsoft.UI.Xaml;\n\nnamespace ${ns};\n\npublic sealed partial class MainWindow : Window\n{\n` +
      '    private int count;\n    public MainWindow() { InitializeComponent(); }\n' +
      '    private void Increment(object sender, RoutedEventArgs args)\n    {\n        CounterText.Text = $"Count: {++count}";\n    }\n}\n');
    put('app.manifest', '<?xml version="1.0" encoding="utf-8"?>\n<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">\n' +
      '  <assemblyIdentity version="1.0.0.0" name="Application.app" />\n' +
      '  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>\n' +
      '    <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />\n' +
      '  </application></compatibility>\n</assembly>\n');
  }
  if (template.id === 'winui-native-tests') {
    records.find(record => record.path === joinPath(folder, 'App.xaml.cs')).text = winuiTestApplication(ns);
    put('UnitTest1.cs', winuiTestSource(ns));
  }
  if (template.id === 'winui-native-packaged') {
    put('Package.appxmanifest', packageManifest(name));
    for (const [path, width, height] of [['StoreLogo', 50, 50], ['Square44x44Logo', 44, 44], ['Square150x150Logo', 150, 150], ['Wide310x150Logo', 310, 150]]) {
      records.push({ path: joinPath(folder, 'Assets', path + '.png'), bytes: templateLogo(width, height) });
    }
  }
  put('README.md', `# ${name}\n\nRequires Windows, the .NET SDK and Windows App SDK ${windowsAppSdkVersion}.\n\n` +
    '`dotnet restore` then `dotnet build -p:Platform=x64`\n\n' +
    (template.id === 'winui-native-tests' ?
      '`dotnet run -p:Platform=x64` runs the MSTest app, including its UI-thread test, and returns the test runner exit code.\n\n' : '') +
    'Generated native XAML is compiled by Windows App SDK. Browser XAML loading and native execution are unavailable.\n');
  return { records, folders: [], projectPath: joinPath(folder, name + '.csproj'),
    openFile: joinPath(folder, library ? 'Class1.cs' : 'MainWindow.xaml'), library, winui: true,
    warnings: ['Windows-native generation; the Windows qualification runner must verify build and runtime behavior.'] };
}
