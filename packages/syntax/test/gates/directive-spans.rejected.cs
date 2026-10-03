// langversion preview: expect the diagnostics recorded in the .roslyn.json beside this file
class A { }
using System;
#pragma warning enable 168
#pragma warning disable 168
#pragma warning restore
#pragma warning foo
#pragma warning
#pragma checksum
#pragma foo
namespace N { class B { } using System.IO; }
