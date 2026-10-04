import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCentralPackages } from '@sharpforge/msbuild';

test('A23 literal central-package inspection rejects constructs requiring evaluation', () => {
  const inputs = [
    '<Import Project="other.props"/>',
    '<ImportGroup><Import Project="other.props"/></ImportGroup>',
    '<Choose><When Condition="true"><ItemGroup/></When></Choose>',
    '<PropertyGroup><CentralPackageTransitivePinningEnabled Condition="false">true</CentralPackageTransitivePinningEnabled></PropertyGroup>',
    '<PropertyGroup><CentralPackageTransitivePinningEnabled>$(Pinning)</CentralPackageTransitivePinningEnabled></PropertyGroup>',
    '<ItemGroup><PackageVersion Include="A"><Version Condition="false">2.0.0</Version></PackageVersion></ItemGroup>',
    '<ItemGroup><PackageVersion Include="$(PackageName)" Version="1.0.0"/></ItemGroup>',
    '<ItemGroup><PackageVersion Include="A" Version="%(Version)"/></ItemGroup>'
  ];
  for (const input of inputs) assert.throws(() => parseCentralPackages('<Project>' + input + '</Project>'), /evaluated/);
  const literal = parseCentralPackages('<Project><PropertyGroup><CentralPackageTransitivePinningEnabled>true'
    + '</CentralPackageTransitivePinningEnabled></PropertyGroup><ItemGroup>'
    + '<PackageVersion Include="A"><Version>1.0.0</Version></PackageVersion></ItemGroup></Project>');
  assert.deepEqual(literal.packageVersions, [{ id: 'A', version: '1.0.0' }]);
  assert.equal(literal.transitivePinning, true);
});
