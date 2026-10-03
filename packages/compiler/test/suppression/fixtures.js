/**
 * Input of the warning-suppression differential fixtures (SF-A02-T37): C# sources plus compilation options. The Roslyn
 * oracle pins, per fixture, the unfiltered diagnostics (`raw`: #pragma lines blanked, every warning level on,
 * attribute-suppressed diagnostics included), the SuppressMessage attributes it binds (`suppressions`) and the final
 * list Roslyn reports (`expected`). `analyzers:true` adds the oracle's probe analyzer (SFA001 warning on each local,
 * SFA002 info on each method, SFA003 warning on each class, SFA004 info on each namespace name): Roslyn applies SuppressMessage to non-compiler
 * diagnostics only, so those fixtures need some.
 * Edit this file, then rerun generate.js to refresh roslyn-suppression.json.
 */
const body=(before='',inside='',after='')=>`using System;
class Old { [Obsolete] public static void M() {} [Obsolete("use N")] public static void N() {} }
class lower {}
${before}class C
{
    int unusedField;
    int assignedField = 1;
    void M()
    {
${inside}        int a;
        int b = 1;
        long c = 1l;
        Old.M();
        Old.N();
        goto done;
        GC.Collect();
    done: ;
    unusedLabel: ;
#warning custom
${after}        int d;
    }
}
`;
const plain=body();
const source=(text,uri='a.cs')=>({uri,text});
const attributed=`using System.Diagnostics.CodeAnalysis;
class A
{
    [SuppressMessage("Probe", "SFA001")]
    [SuppressMessage("Compiler", "CS0168")]
    void M() { int a; int b = 1; }
    void N() { int c; }
}
[SuppressMessage("Probe", "SFA001:Local", Justification = "test")]
[SuppressMessage("Probe", "sfa002")]
class B
{
    void M() { int a; int b = 1; }
    class Inner { void N() { int d = 2; int e; } }
}
`;
const assemblyLevel=`using System.Diagnostics.CodeAnalysis;
[assembly: SuppressMessage("Probe", "SFA001", Scope = "member", Target = "~M:N.A.M")]
[assembly: SuppressMessage("Probe", "SFA002", Scope = "type", Target = "~T:N.B")]
[assembly: SuppressMessage("Compiler", "CS0168", Scope = "type", Target = "~T:N.B")]
[module: SuppressMessage("Probe", "SFA003")]
namespace N
{
    class A
    {
        void M() { int a; int b = 1; }
        void O() { int c; }
    }
    class B
    {
        void M() { int a; int b = 1; }
        class Inner { void P() { } }
    }
}
`;
const namespaces=`using System.Diagnostics.CodeAnalysis;
[assembly: SuppressMessage("Probe", "SFA001", Scope = "namespaceanddescendants", Target = "~N:N1")]
[assembly: SuppressMessage("Probe", "SFA001", Scope = "namespace", Target = "~N:N2")]
[assembly: SuppressMessage("Probe", "SFA003", Scope = "namespace", Target = "~N:N2")]
[assembly: SuppressMessage("Probe", "SFA004", Scope = "namespace", Target = "~N:N2")]
[assembly: SuppressMessage("Probe", "SFA004", Scope = "namespaceanddescendants", Target = "~N:N4")]
[assembly: SuppressMessage("Probe", "SFA002", Scope = "member", Target = "~M:N3.Missing.M")]
namespace N1 { class A { void M() { int a; } } }
namespace N2 { class A { void M() { int a; } } }
namespace N3 { class A { void M() { int a; } } }
namespace N4 { namespace Inner { class A { } } }
`;

export const fixtures=[
  {name:'defaults',sources:[source(plain)],options:{}},
  {name:'pragma disable by number and by id, then restore',sources:[source(body('','#pragma warning disable 168, CS0219 // locals\n','#pragma warning restore 168\n'))],options:{}},
  {name:'pragma disable all, restore all',sources:[source(body('#pragma warning disable\n','','#pragma warning restore\n'))],options:{}},
  {name:'pragma disable all, restore one id',sources:[source(body('#pragma warning disable\n','#pragma warning restore CS0219\n',''))],options:{}},
  {name:'pragma disable one id, restore all',sources:[source(body('','#pragma warning disable CS0168\n#pragma warning disable CS0612\n','   #  pragma   warning   restore\n'))],options:{}},
  {name:'pragma id spellings',sources:[source(body('','#pragma warning disable cs0168\n#pragma warning disable 0219\n#pragma warning disable 78,612 , CS0618\n',''))],options:{}},
  {name:'pragma text inside comments and strings is not a directive',sources:[source(body('/*\n#pragma warning disable\n*/\nclass S { string s = @"\n#pragma warning disable\n"; string t = """\n#pragma warning disable\n"""; char q = \'"\'; string u = "/*"; }\n','// #pragma warning disable CS0168\n',''))],options:{}},
  {name:'pragma inside inactive and active conditional regions',defines:['ON'],sources:[source(body('','#if OFF\n#pragma warning disable CS0168\n#elif ON && !OFF\n#pragma warning disable CS0219\n#else\n#pragma warning disable CS0612\n#endif\n#if !(ON || OFF) == false\n#pragma warning disable CS0618\n#if OFF\n#pragma warning disable CS0078\n#else\n#pragma warning disable CS0164\n#endif\n#endif\n#if false\n#if ON\n#pragma warning disable CS0612\n#endif\n#elif true\n#pragma warning disable CS0162\n#elif ON\n#pragma warning disable CS1030\n#endif\n',''))],options:{}},
  {name:'pragma after #define and #undef',sources:[source('#define A\n#undef B\n#if A && !B\n#pragma warning disable CS0168\n#endif\n#if B\n#pragma warning disable CS0219\n#endif\nclass C { void M() { int a; int b = 1; } }\n')],options:{}},
  {name:'malformed pragmas',sources:[source(body('','#pragma warning foo\n#pragma foo\n#pragma warning disable "x"\n#pragma warning disable 168 extra\n#pragma warning disable CS0219,\n#pragma warning\n#pragma\n#pragma warning disable 1e3\n#pragma warning restore , 78\n#pragma warning disable 612 // fine\n#pragma warning disable "y", 618\n#pragma warning restore 168 /* junk */\n#pragma checksum "a.cs" "{406EA660-64CF-4C82-B6F0-42D48172A799}" "ab007f1d23d9"\n#pragma warning disable @CS0162\n',''))],options:{}},
  {name:'pragma in one file does not affect another',sources:[source(body('#pragma warning disable\n','','')),source('class D { void M() { int z; } }\n','b.cs')],options:{}},
  {name:'nowarn by id and number',sources:[source(plain)],options:{noWarn:['CS0168','219','0078']}},
  {name:'option ids accept the CS prefix in any case',sources:[source(plain)],options:{noWarn:['cs0168'],warnAsError:['Cs0219'],warnNotAsError:['cs612'],treatWarningsAsErrors:true}},
  {name:'custom option ids are case-sensitive',analyzers:true,sources:[source('class A\n{\n    void M() { int a = 1; a++; }\n}\n')],options:{noWarn:['sfa001'],warnAsError:['Sfa003']}},
  {name:'pragma directive warnings obey pragmas and options',sources:[source('#pragma warning disable CS1634\n#pragma warning foo\n#pragma warning restore CS1634\n#pragma warning bar\n#pragma nope\nclass C { }\n#pragma warning disable 1696\n#pragma warning disable 168 junk\n')],options:{warnAsError:['CS1633']}},
  {name:'directive forms and line endings',sources:[source('class C\r\n{\r\n    void M()\r\n    {\r\n\t#pragma warning disable CS0168 // crlf\r\n        int a;\r\n#pragma warning restore CS0168\r\n        int b; #pragma warning disable CS0168\r\n        int c;\r\n    }\r\n}\r\n#pragma warning disable')],options:{}},
  {name:'warnaserror for specific ids',sources:[source(plain)],options:{warnAsError:['CS0168','612']}},
  {name:'treat warnings as errors',sources:[source(plain)],options:{treatWarningsAsErrors:true}},
  {name:'treat warnings as errors except some',sources:[source(plain)],options:{treatWarningsAsErrors:true,warnNotAsError:['CS0219','618']}},
  {name:'nowarn wins over warnaserror',sources:[source(plain)],options:{warnAsError:['CS0168','CS0219'],noWarn:['CS0168']}},
  {name:'treat warnings as errors with pragma and nowarn',sources:[source(body('','#pragma warning disable CS0168\n','#pragma warning restore CS0168\n'))],options:{treatWarningsAsErrors:true,noWarn:['CS0612']}},
  {name:'pragma restore does not undo nowarn',sources:[source(body('','#pragma warning restore CS0168\n',''))],options:{noWarn:['CS0168']}},
  {name:'pragma disable beats warnaserror',sources:[source(body('','#pragma warning disable CS0168\n','#pragma warning restore CS0168\n'))],options:{warnAsError:['CS0168']}},
  {name:'warning level 0',sources:[source(plain)],options:{warningLevel:0}},
  {name:'warning level 1',sources:[source(plain)],options:{warningLevel:1}},
  {name:'warning level 2',sources:[source(plain)],options:{warningLevel:2}},
  {name:'warning level 3',sources:[source(plain)],options:{warningLevel:3}},
  {name:'warning level 5',sources:[source(plain)],options:{warningLevel:5}},
  {name:'warning level 9999',sources:[source(plain)],options:{warningLevel:9999}},
  {name:'warning level 2 with warnaserror for a level 3 warning',sources:[source(plain)],options:{warningLevel:2,warnAsError:['CS0168'],treatWarningsAsErrors:true}},
  {name:'errors are never suppressed',sources:[source('class E\n{\n#pragma warning disable\n#pragma warning disable CS0029\n    void M() { int x = "s"; int y; undefined(); }\n}\n')],options:{noWarn:['CS0029','CS0103'],warningLevel:0}},
  {name:'analyzer diagnostics follow pragma, nowarn and warnaserror',analyzers:true,sources:[source('class A\n{\n    void M() { int a = 1; a++; }\n#pragma warning disable SFA001, SFA002\n    void N() { int b = 1; b++; }\n#pragma warning restore SFA001\n    void O() { int c = 1; c++; }\n}\nclass B { }\n')],options:{warnAsError:['SFA001'],noWarn:['SFA003']}},
  {name:'analyzer info diagnostics are not promoted to errors',analyzers:true,sources:[source('class A\n{\n    void M() { int a = 1; a++; }\n}\n')],options:{treatWarningsAsErrors:true,warningLevel:0}},
  {name:'SuppressMessage on a member and a type',analyzers:true,defines:['CODE_ANALYSIS'],sources:[source(attributed)],options:{}},
  {name:'SuppressMessage at assembly level',analyzers:true,defines:['CODE_ANALYSIS'],sources:[source(assemblyLevel),source('namespace N { class Z { void M() { int a; int b = 1; } } }\n','b.cs')],options:{treatWarningsAsErrors:true}},
  {name:'SuppressMessage namespace scopes',analyzers:true,defines:['CODE_ANALYSIS'],sources:[source(namespaces)],options:{}},
  {name:'SuppressMessage applies without CODE_ANALYSIS too',analyzers:true,sources:[source(attributed)],options:{}}
];
