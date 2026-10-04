#nullable enable
namespace NoTransformControl
{
    public class Control
    {
        public string A = "";
        public string B = "";
        public string C = "";
        public string D = "";
        public string E = "";

        public int Plain(int value) => value;
        public void Empty() { }
        public int Generic<T>(int value) where T : struct => value;
        public string? ReturnOnly() => null;

#nullable disable
        public object Oblivious(object value) => value;
#nullable enable
        public class Outer<T> where T : struct
        {
            public class Inner<U> where U : struct
            {
                public int Plain(int value) => value;
                public void Empty() { }
                public int Generic<V>(int value) where V : struct => value;
            }
        }
    }

    public delegate int PrimitiveDelegate(int value);
    public delegate T GenericDelegate<T>(T value) where T : struct;
}
