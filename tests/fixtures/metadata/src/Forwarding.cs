// Type-forwarding fixtures; one source, several roles selected by a define.
//   FACADE_OLD      Facade 1.0.0.0 that still defines Lib.Widget itself (build-time only, not checked in)
//   FACADE          Facade 1.0.0.0 that forwards Lib.Widget and Lib.Gadget to VersionedLib
//   FACADE_CONSUMER compiled against FACADE_OLD, so its TypeRefs for Lib.Widget name the Facade assembly
//   CYCLE_*         two assemblies that forward Loop.Node to each other (CS0731)
using System.Runtime.CompilerServices;
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
#if FACADE_OLD
namespace Lib { public class Widget { public int Size; } public class Gadget { public Widget Owner; } }
#elif FACADE
[assembly: TypeForwardedTo(typeof(Lib.Widget))]
[assembly: TypeForwardedTo(typeof(Lib.Gadget))]
namespace Facade { public class Marker { } }
#elif FACADE_CONSUMER
namespace Client
{
    public class Shelf : Lib.Widget { public Lib.Gadget First; }
}
#elif CYCLE_DEFINES
namespace Loop { public class Node { } }
#elif CYCLE_FORWARDS
[assembly: TypeForwardedTo(typeof(Loop.Node))]
#elif CYCLE_CONSUMER
namespace Client { public class Walker { public Loop.Node Start; } }
#endif
