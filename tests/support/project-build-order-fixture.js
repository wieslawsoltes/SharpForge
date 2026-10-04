/** Shared native/portable fixture: a dependency's after-build source is consumed before its caller compiles. */
export function projectBuildOrderFiles({framework = 'net10.0', failure = ''} = {}) {
  const sdk = body => '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + `<TargetFramework>${framework}</TargetFramework><GenerateAssemblyInfo>false</GenerateAssemblyInfo>`
    + '<EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup>' + body + '</Project>';
  return [
    {path: 'Lib/Lib.csproj', text: sdk('<ItemGroup><Compile Include="Code.cs"/></ItemGroup>'
      + '<Target Name="CreateVersion" AfterTargets="Build">'
      + '<WriteLinesToFile File="../Shared/Version.cs" '
      + 'Lines="public class Generated { public static int Version() { return 42%3B } }" Overwrite="true"/>'
      + (failure === 'after' ? '<Error Text="dependency after failed" Code="AFTERFAIL"/>' : '') + '</Target>')},
    {path: 'Lib/Code.cs', text: failure === 'compile' ? 'class Broken { void M( }' : 'public class Library {}'},
    {path: 'App/App.csproj', text: sdk('<PropertyGroup><OutputType>Exe</OutputType></PropertyGroup>'
      + '<ItemGroup><ProjectReference Include="../Lib/Lib.csproj"/><Compile Include="Program.cs"/></ItemGroup>'
      + '<Target Name="ReadVersion" BeforeTargets="BeforeCompile">'
      + '<Copy SourceFiles="../Shared/Version.cs" DestinationFiles="Generated.cs"/>'
      + '<ItemGroup><Compile Include="Generated.cs"/></ItemGroup></Target>')},
    {path: 'App/Program.cs', text: 'System.Console.WriteLine(Generated.Version());'},
  ];
}
