// Built against VersionedLib 1.0.0.0 (ConsumerOfV1) and 2.0.0.0 (ConsumerOfV2).
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
namespace App
{
    public class Holder : Lib.Widget
    {
        public Lib.Gadget Make(Lib.Widget seed) => null;
        public System.Collections.Generic.List<Lib.Widget> All;
    }
}
