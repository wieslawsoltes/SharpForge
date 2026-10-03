class A : System.Attribute { }
class C
{
    System.Func<int> f = [A] () => 1;
}
