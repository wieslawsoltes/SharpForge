// langversion 9: expect the language-version diagnostics recorded in the .roslyn.json beside this file
class C
{
#line (1, 2) - (3, 4) "a.cs"
    int f;
#line (5, 1) - (5, 9) 3 "b.cs"
#line default
}
