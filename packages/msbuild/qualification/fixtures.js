import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createQualificationFixtures(root, sdk) {
  const framework = 'net' + sdk.version.split('.')[0] + '.0';
  await mkdir(join(root, 'App'), { recursive: true });
  await mkdir(join(root, 'Library'), { recursive: true });
  await mkdir(join(root, 'Failure'), { recursive: true });
  const files = {
    'global.json': JSON.stringify({ sdk: { version: sdk.version, rollForward: 'disable', allowPrerelease: true } }),
    'NuGet.Config': '<configuration><packageSources><clear /></packageSources></configuration>',
    'App/App.csproj': `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>${framework}</TargetFramework>`
      + `<OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings>`
      + `<PackageId>SharpForge.Qualification</PackageId><Version>1.0.0</Version></PropertyGroup><ItemGroup>`
      + `<ProjectReference Include="../Library/Library.csproj" /></ItemGroup></Project>`,
    'App/Program.cs': 'System.Console.WriteLine(Qualification.Library.Answer);',
    'Library/Library.csproj': `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>${framework}</TargetFramework></PropertyGroup></Project>`,
    'Library/Library.cs': 'namespace Qualification; public static class Library { public const int Answer = 42; }',
    'Failure/Failure.csproj': `<Project Sdk="Microsoft.NET.Sdk" InitialTargets="QualificationFailure"><PropertyGroup>`
      + `<TargetFramework>${framework}</TargetFramework></PropertyGroup>`
      + `<Target Name="QualificationFailure" BeforeTargets="Restore;Build;Pack;Publish">`
      + `<Error Code="SFQA1001" Text="Expected qualification failure" /></Target></Project>`,
    'Fixture.slnx': '<Solution><Project Path="Library/Library.csproj" /><Project Path="App/App.csproj" /></Solution>',
    'Fixture.sln': [
      "Microsoft Visual Studio Solution File, Format Version 12.00",
      "# Visual Studio Version 17",
      "Project(\"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}\") = \"Library\", \"Library\\Library.csproj\", \"{11111111-1111-1111-1111-111111111111}\"",
      "EndProject",
      "Project(\"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}\") = \"App\", \"App\\App.csproj\", \"{22222222-2222-2222-2222-222222222222}\"",
      "EndProject",
      "Global",
      "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution",
      "\t\tDebug|Any CPU = Debug|Any CPU",
      "\tEndGlobalSection",
      "\tGlobalSection(ProjectConfigurationPlatforms) = postSolution",
      "\t\t{11111111-1111-1111-1111-111111111111}.Debug|Any CPU.ActiveCfg = Debug|Any CPU",
      "\t\t{11111111-1111-1111-1111-111111111111}.Debug|Any CPU.Build.0 = Debug|Any CPU",
      "\t\t{22222222-2222-2222-2222-222222222222}.Debug|Any CPU.ActiveCfg = Debug|Any CPU",
      "\t\t{22222222-2222-2222-2222-222222222222}.Debug|Any CPU.Build.0 = Debug|Any CPU",
      "\tEndGlobalSection",
      "EndGlobal",
      "",
    ].join('\n')
  };
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  return { framework, projects: ['App/App.csproj', 'Library/Library.csproj'] };
}
