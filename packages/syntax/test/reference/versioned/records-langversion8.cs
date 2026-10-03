// roslyn: langversion=8
class C
{
    record field;
    record Method(record p) { return p; }
    record Property { get; set; }
    static record Shared = null;
    void M() { record local = field; record(); }
    void record() { }
}
class record { }
