class Marker<T> : System.Attribute { }
class C
{
    [Marker<int>]
    void M() { }
}
