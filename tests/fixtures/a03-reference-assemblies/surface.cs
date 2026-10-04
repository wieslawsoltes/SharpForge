using System;

namespace RefSurface
{
    internal sealed class LocalAttribute : Attribute
    {
        internal LocalAttribute(int value) { }
        private void Implementation() { }
    }

    public interface IContract
    {
        int Read();
        int Value { get; }
        event Action Changed;
    }

    [Local(7)]
    public class Contract : IContract
    {
        private int secret;
        internal int internalField;
        protected int protectedField;
        public const int Answer = 42;

        static Contract() { }
        public Contract() { }
        private Contract(int value) { }
        public int Read() { return 42; }
        private int Hidden() { return 1; }
        internal int Internal() { return 2; }
        protected int Protected() { return 3; }
        internal virtual int Virtual() { return 4; }
        public int Value { get; private set; }
        private int SecretProperty { get; set; }
        internal int InternalProperty { get; set; }
        public event Action Changed;
        private event Action SecretEvent;
        internal event Action InternalEvent;
        int IContract.Read() { return 5; }

        private sealed class Nested
        {
            public void Visible() { }
            private void Hidden() { }
        }
    }

    public struct Payload
    {
        private object reference;
        internal int number;
        private static int cached;
        public int Value { get; private set; }
    }

    public enum Choice : byte { First = 1, Second = 2 }
    public delegate int Callback(int value);

    public interface IFactory
    {
        static abstract int Create();
        static abstract int Value { get; }
        static abstract event Action Changed;
    }

    public class Factory : IFactory
    {
        static int IFactory.Create() { return 1; }
        static int IFactory.Value { get { return 2; } }
        static event Action IFactory.Changed { add { } remove { } }
    }

    public unsafe struct Packet { public fixed int Data[4]; }
    public struct Captured(object value) { public object Read() { return value; } }
}
