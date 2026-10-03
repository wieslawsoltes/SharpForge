// langversion 10: expect CS8936 at 54 "Marker<int>"
class Marker<T> : System.Attribute { }
class C
{
    [Marker<int>]
    void M() { }
}
