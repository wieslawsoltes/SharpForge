/** Managed assertion implementations for the explicitly supported portable profile; unknown APIs remain compiler diagnostics. */
export function portableAssertionSource() {
  const scalar = ['int', 'double', 'bool', 'string'];
  const equality = (name, unequal = false) => scalar.map(type => `public static void ${name}(${type} expected, ${type} actual) {
    if (expected ${unequal ? '==' : '!='} actual) throw new System.Exception("SFT_ASSERT: ${name} failed");
  }`).join('\n');
  const asserts = `${equality('Equal')}
    ${equality('NotEqual', true)}
    public static void True(bool value) { if (!value) throw new System.Exception("SFT_ASSERT: True failed"); }
    public static void False(bool value) { if (value) throw new System.Exception("SFT_ASSERT: False failed"); }
    public static void True(bool value, string message) { if (!value) throw new System.Exception("SFT_ASSERT: " + message); }
    public static void False(bool value, string message) { if (value) throw new System.Exception("SFT_ASSERT: " + message); }
    public static void Null(object value) { if (value != null) throw new System.Exception("SFT_ASSERT: Null failed"); }
    public static void NotNull(object value) { if (value == null) throw new System.Exception("SFT_ASSERT: NotNull failed"); }
    public static void Fail(string message) { throw new System.Exception("SFT_ASSERT: " + message); }
    public static void Same(object expected, object actual) { if (expected != actual) throw new System.Exception("SFT_ASSERT: Same failed"); }
    public static void NotSame(object expected, object actual) { if (expected == actual) throw new System.Exception("SFT_ASSERT: NotSame failed"); }`;
  const classical = `${equality('AreEqual')}${equality('AreNotEqual', true)}
    public static void IsTrue(bool value) { if (!value) throw new System.Exception("SFT_ASSERT: IsTrue failed"); }
    public static void IsFalse(bool value) { if (value) throw new System.Exception("SFT_ASSERT: IsFalse failed"); }
    public static void IsNull(object value) { if (value != null) throw new System.Exception("SFT_ASSERT: IsNull failed"); }
    public static void IsNotNull(object value) { if (value == null) throw new System.Exception("SFT_ASSERT: IsNotNull failed"); }
    public static void Fail(string message) { throw new System.Exception("SFT_ASSERT: " + message); }`;
  return `namespace Xunit {
    public interface IClassFixture<T> { }
    public interface ICollectionFixture<T> { }
    public interface IAsyncLifetime { System.Threading.Tasks.Task InitializeAsync(); System.Threading.Tasks.Task DisposeAsync(); }
    public static class Assert { ${asserts} }
  }
  namespace NUnit.Framework {
    public class IntConstraint { public int Expected; public IntConstraint(int expected) { Expected = expected; } }
    public class StringConstraint { public string Expected; public StringConstraint(string expected) { Expected = expected; } }
    public class BoolConstraint { public bool Expected; public BoolConstraint(bool expected) { Expected = expected; } }
    public static class Is {
      public static IntConstraint EqualTo(int expected) { return new IntConstraint(expected); }
      public static StringConstraint EqualTo(string expected) { return new StringConstraint(expected); }
      public static BoolConstraint EqualTo(bool expected) { return new BoolConstraint(expected); }
      public static BoolConstraint True { get { return new BoolConstraint(true); } }
      public static BoolConstraint False { get { return new BoolConstraint(false); } }
    }
    public static class Assert { ${classical}
      public static void That(int value, IntConstraint constraint) { AreEqual(constraint.Expected, value); }
      public static void That(string value, StringConstraint constraint) { AreEqual(constraint.Expected, value); }
      public static void That(bool value, BoolConstraint constraint) { if (value != constraint.Expected) Fail("That failed"); }
      public static void Ignore(string message) { throw new System.Exception("SFT_SKIP: " + message); }
      public static void Inconclusive(string message) { throw new System.Exception("SFT_NOTRUNNABLE: " + message); }
    }
  }
  namespace NUnit.Framework.Legacy { public static class ClassicAssert { ${classical} } }
  namespace Microsoft.VisualStudio.TestTools.UnitTesting {
    public class TestContext {
      public string TestName { get; set; }
      public void WriteLine(string text) { System.Console.WriteLine(text); }
    }
    public static class Assert { ${classical}
      public static void Inconclusive(string message) { throw new System.Exception("SFT_NOTRUNNABLE: " + message); }
    }
  }`;
}

export const portableAssertionCapabilities = Object.freeze({
  xunit: ['True', 'False', 'Equal(int/double/bool/string)', 'NotEqual(int/double/bool/string)', 'Null', 'NotNull', 'Same', 'NotSame', 'Fail'],
  nunit: ['AreEqual', 'AreNotEqual', 'IsTrue', 'IsFalse', 'IsNull', 'IsNotNull', 'That(int/string/bool, Is.EqualTo)', 'Ignore', 'Inconclusive', 'Fail'],
  mstest: ['AreEqual', 'AreNotEqual', 'IsTrue', 'IsFalse', 'IsNull', 'IsNotNull', 'Inconclusive', 'Fail']
});
