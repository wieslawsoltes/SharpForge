// roslyn: langversion=8 gates=binder
record R(int X);
record S { }
public record T(int A, string B);
class C
{
    record field;
    record M(record p) { return p; }
    record R2(int X);
    public record struct V(int A);
}
record struct W(int A);
record class Q(int A);
