// langversion preview: expect the language-version diagnostics recorded in the .roslyn.json beside this file
extern alias First;
global using System;
extern alias AfterGlobalUsing;
using System.IO;
extern alias AfterUsing;
namespace N
{
    extern alias Inner;
    using System.Text;
    extern alias InnerAfterUsing;
    class C { }
    extern alias InnerAfterMember;
}
extern alias AfterMember;
