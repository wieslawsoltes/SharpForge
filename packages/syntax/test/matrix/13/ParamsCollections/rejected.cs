// langversion 12: expect CS9202 at 21 "params System.Collections.Generic.List<int> values"
class C
{
    void M(params System.Collections.Generic.List<int> values) { }
}
