// Built three times with LIB_V1 / LIB_V105 / LIB_V2 to produce VersionedLib 1.0.0.0, 1.0.0.5 and 2.0.0.0.
#if LIB_V2
[assembly: System.Reflection.AssemblyVersion("2.0.0.0")]
#elif LIB_V105
[assembly: System.Reflection.AssemblyVersion("1.0.0.5")]
#else
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
#endif
namespace Lib
{
    public class Widget
    {
        public int Size;
#if LIB_V2
        public int Weight;
#endif
    }
    public class Gadget { public Widget Owner; }
}
