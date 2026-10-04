export const msbuildDifferentialCorpus = [
  {id: 'property-order', feature: 'property-expansion', propertyNames: ['Value', 'Other'], itemNames: [], files: [
    {path: 'Test.csproj', text: '<Project><PropertyGroup><Value>one</Value><Other>$(Value)-two</Other><Value>three</Value></PropertyGroup></Project>'}
  ]},
  {id: 'conditioned-properties', feature: 'conditions', propertyNames: ['Value'], itemNames: [], files: [
    {path: 'Test.csproj', text: '<Project><PropertyGroup Condition="\'$(Configuration)\' == \'Debug\'"><Value>yes</Value></PropertyGroup></Project>'}
  ]},
  {id: 'literal-include-update-remove', feature: 'generic-items', propertyNames: ['Value'], itemNames: ['Content'], metadataNames: {Content: ['Link']}, files: [
    {path: 'Test.csproj', text: '<Project><PropertyGroup><Value>items</Value></PropertyGroup><ItemGroup><Content Include="A.txt;B.txt"/>' +
      '<Content Update="A.txt"><Link>Shown.txt</Link></Content><Content Remove="B.txt"/></ItemGroup></Project>'},
    {path: 'A.txt', text: 'A'}, {path: 'B.txt', text: 'B'}
  ]},
  {id: 'import-order', feature: 'local-imports', propertyNames: ['Value'], itemNames: [], files: [
    {path: 'Test.csproj', text: '<Project><Import Project="Values.props"/><PropertyGroup><Value>$(Value)-last</Value></PropertyGroup></Project>'},
    {path: 'Values.props', text: '<Project><PropertyGroup><Value>first</Value></PropertyGroup></Project>'}
  ]},
  {id: 'property-function', feature: 'string-property-functions', propertyNames: ['Value'], itemNames: [], files: [
    {path: 'Test.csproj', text: '<Project><PropertyGroup><Value>$([System.String]::Copy(\'hello\').ToUpperInvariant())</Value></PropertyGroup></Project>'}
  ]}
];

const blocked = (id, feature, text, files = [], extra = {}) => ({id, feature, propertyNames: [], itemNames: [],
  files: [{path: 'Test.csproj', text}, ...files], ...extra});

msbuildDifferentialCorpus.push(
  blocked('native-exec', 'native-task-execution', '<Project><Target Name="Build"><Exec Command="echo unsafe"/></Target></Project>'),
  blocked('native-csc', 'native-task-execution', '<Project><Target Name="Build"><Csc Sources="A.cs"/></Target></Project>'),
  blocked('custom-using-task', 'external-task-assembly', '<Project><UsingTask TaskName="Custom" AssemblyFile="Custom.dll"/></Project>'),
  blocked('unknown-sdk', 'unregistered-sdk', '<Project Sdk="Unregistered.Native.Sdk"/>'),
  blocked('binary-reference', 'binary-reference-linking', '<Project><ItemGroup><Reference Include="External"/></ItemGroup></Project>'),
  blocked('package-reference', 'nuget-restore-linking', '<Project><ItemGroup><PackageReference Include="External" Version="1.0"/></ItemGroup></Project>'),
  blocked('analyzer', 'analyzer-execution', '<Project><ItemGroup><Analyzer Include="Custom.dll"/></ItemGroup></Project>'),
  blocked('serialized-resx', 'serialized-resources', '<Project><ItemGroup><EmbeddedResource Include="Data.resx"/></ItemGroup></Project>',
    [{path: 'Data.resx', text: '<root><data name="Object" mimetype="application/x-microsoft.net.object.binary.base64"><value>AA==</value></data></root>'}]),
  blocked('host-file-function', 'host-property-functions', '<Project><PropertyGroup><Value>$([System.IO.File]::ReadAllText(\'secret\'))</Value></PropertyGroup></Project>'),
  blocked('foreign-language-build', 'foreign-language-compilation', '<Project/>', [{path: 'Foreign.fsproj', text: '<Project/>'}],
    {entry: 'Foreign.fsproj', phase: 'build-plan'})
);
