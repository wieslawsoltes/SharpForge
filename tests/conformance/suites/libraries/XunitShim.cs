// SharpForge's deliberately small test adapter. Assertions fail by throwing.
using System;
namespace Xunit
{
    public static class Assert
    {
        public static void True(bool value) { if (!value) throw new Exception("Assert.True"); }
        public static void False(bool value) { if (value) throw new Exception("Assert.False"); }
        public static void Null(object value) { if (value != null) throw new Exception("Assert.Null"); }
        public static void NotNull(object value) { if (value == null) throw new Exception("Assert.NotNull"); }
        public static void Same(object expected, object actual)
        { if (!object.ReferenceEquals(expected, actual)) throw new Exception("Assert.Same"); }
        public static void Equal<T>(T expected, T actual)
        {
            if (expected is System.Collections.IEnumerable && !(expected is string))
                throw new NotSupportedException("Shim Equal supports scalar values only, not sequence equality");
            if (!object.Equals(expected, actual)) throw new Exception("Assert.Equal");
        }
        public static T Throws<T>(Action action) where T : Exception
        {
            try { action(); }
            catch (Exception error)
            {
                if (error.GetType() != typeof(T)) throw new Exception("Assert.Throws: wrong exception type");
                return (T)error;
            }
            throw new Exception("Assert.Throws: no exception");
        }
    }
}
