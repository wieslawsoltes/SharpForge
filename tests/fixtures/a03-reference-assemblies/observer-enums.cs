using System;
using System.Diagnostics;

namespace EnumObservation
{
    public enum ByteChoice : byte { Maximum = 255 }
    public enum WideChoice : ulong { Large = 4294967296 }

    public sealed class EnumArgumentsAttribute : Attribute
    {
        public EnumArgumentsAttribute(ByteChoice narrow, WideChoice wide, DebuggerBrowsableState external,
            object boxed, ByteChoice[] array, Type type) { }
        public ByteChoice Choice { get; set; }
        public ByteChoice[] NullValues { get; set; }
    }

    [EnumArguments(ByteChoice.Maximum, WideChoice.Large, DebuggerBrowsableState.Never,
        WideChoice.Large, new[] { ByteChoice.Maximum }, typeof(int), Choice = ByteChoice.Maximum, NullValues = null)]
    public sealed class Probe { }
}
