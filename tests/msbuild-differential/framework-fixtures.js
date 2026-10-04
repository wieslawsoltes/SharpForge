const testSdk = {name: 'Microsoft.NET.Test.Sdk', version: '17.13.0'};
const coverage = {name: 'coverlet.collector', version: '6.0.4'};

/** Pinned native framework inputs; package acquisition is confined to the opt-in native qualification command. */
export const frameworkFixtures = [
  {framework: 'xunit', packages: [testSdk, coverage, {name: 'xunit', version: '2.9.3'},
    {name: 'xunit.runner.visualstudio', version: '3.0.2'}], source: `using System;
using System.Collections;
using System.Collections.Generic;
using Xunit;
namespace ReferenceFixture {
public class ClassRows : IEnumerable<object[]> {
  public IEnumerator<object[]> GetEnumerator() { yield return new object[] { 5 }; }
  IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); }
}
public class Tests {
  [Fact] public void Pass() { Assert.True(true); Console.WriteLine("native and portable"); }
  [Fact] public void Fail() { Assert.Equal(1, 2); }
  [Fact(Skip = "planned")] public void Skip() { throw new Exception("must not execute"); }
  [Theory, InlineData(1), InlineData(2)] public void Inline(int value) { Assert.True(value > 0); }
  public static List<object[]> Rows() {
    var rows = new List<object[]>();
    rows.Add(new object[] { 3 });
    rows.Add(new object[] { 4 });
    return rows;
  }
  [Theory, MemberData(nameof(Rows))] public void Member(int value) { Assert.True(value > 0); }
  [Theory, ClassData(typeof(ClassRows))] public void Class(int value) { Assert.Equal(5, value); }
}
}`},
  {framework: 'nunit', packages: [testSdk, coverage, {name: 'NUnit', version: '4.3.2'},
    {name: 'NUnit3TestAdapter', version: '5.0.0'}], source: `using System;
using NUnit.Framework;
namespace ReferenceFixture {
[TestFixture(3)] public class Tests {
  int value;
  public Tests(int expected) { value = expected; }
  [OneTimeSetUp] public void Once() { value++; }
  [SetUp] public void Before() { Console.WriteLine("setup"); }
  [TearDown] public void After() { Console.WriteLine("cleanup"); }
  [Test] public void Pass() { Assert.That(value, Is.EqualTo(4)); }
  [Test] public void Fail() { Assert.That(1, Is.EqualTo(2)); }
  [Test, Ignore("planned")] public void Skip() { throw new Exception("must not execute"); }
  [TestCase(1), TestCase(2)] public void Inline(int number) { Assert.That(number > 0, Is.True); }
  public static System.Collections.Generic.List<object[]> Rows() {
    var rows = new System.Collections.Generic.List<object[]>();
    rows.Add(new object[] { 5 });
    return rows;
  }
  [TestCaseSource(nameof(Rows))] public void Data(int number) { Assert.That(number, Is.EqualTo(5)); }
}
}`},
  {framework: 'mstest', packages: [testSdk, coverage, {name: 'MSTest.TestFramework', version: '3.8.3'},
    {name: 'MSTest.TestAdapter', version: '3.8.3'}], source: `using System;
using Microsoft.VisualStudio.TestTools.UnitTesting;
namespace ReferenceFixture {
[TestClass] public class Tests {
  int value;
  [TestInitialize] public void Before() { value = 3; }
  [TestCleanup] public void After() { Console.WriteLine("cleanup"); }
  [TestMethod] public void Pass() { Assert.AreEqual(3, value); }
  [TestMethod] public void Fail() { Assert.AreEqual(1, 2); }
  [TestMethod, Ignore("planned")] public void Skip() { throw new Exception("must not execute"); }
  [TestMethod, DataRow(1, DisplayName = "one row"), DataRow(2)]
  public void Inline(int number) { Assert.IsTrue(number > 0); }
  public static System.Collections.Generic.List<object[]> Rows() {
    var rows = new System.Collections.Generic.List<object[]>();
    rows.Add(new object[] { 5 });
    return rows;
  }
  [TestMethod, DynamicData(nameof(Rows), DynamicDataSourceType.Method)] public void Data(int number) { Assert.AreEqual(5, number); }
}
}`}
];

export function nativeFixtureProject(fixture, framework = 'net10.0') {
  return `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>${framework}</TargetFramework>
    <IsTestProject>true</IsTestProject><GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <EnableNETAnalyzers>false</EnableNETAnalyzers><NuGetAudit>false</NuGetAudit></PropertyGroup><ItemGroup>` +
    fixture.packages.map(item => `<PackageReference Include="${item.name}" Version="${item.version}"/>`).join('') +
    '</ItemGroup></Project>';
}
