/** Generate the finite native fixture project without external package dependencies. */
export function nativeFixtureProject(framework, unsafe = false) {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>${framework}</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <Nullable>disable</Nullable>
    <Optimize>true</Optimize>
    <AllowUnsafeBlocks>${unsafe}</AllowUnsafeBlocks>
    <DebugType>none</DebugType>
    <Deterministic>true</Deterministic>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <NuGetAudit>false</NuGetAudit>
  </PropertyGroup>
</Project>
`;
}
