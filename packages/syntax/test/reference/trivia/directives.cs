// roslyn: define=DEBUG;TRACE
#define LOCAL
#undef TRACE
#nullable enable
#pragma warning disable CS0168, 219 // comment
#pragma warning restore
#pragma checksum "file.cs" "{406EA660-64CF-4C82-B6F0-42D48172A799}" "ab007f1d23d9"
using System;
#region Types
class Conditional
{
#if DEBUG
    int debugOnly;
#elif TRACE
    int traceOnly;
#else
    int neither;
#endif
#if !DEBUG || (LOCAL && false)
    this is not lexed at all 'x "unterminated
    #if NESTED
    still skipped
    #else
    also skipped
    #endif
#elif LOCAL == true && !TRACE
    int localOnly;
    #if UNDEFINED
    garbage $$$
    #endif
#endif
    #region Nested region with text
    void M()
    {
#line 200 "Special.cs"
        int a = 1;
#line hidden
        int b = 2;
#line default
#line (1, 2) - (3, 4) 5 "Span.cs"
        int c = 3;
#nullable disable warnings
#nullable restore annotations
#pragma warning disable
#warning This is a warning
    }
    #endregion
}
#endregion Types
#if false
#error never reported
#endif
