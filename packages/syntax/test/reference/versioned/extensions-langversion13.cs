// roslyn: langversion=13
class extension
{
    extension(int a) { }
    extension value;
    int extension2;
    extension Clone() { return this; }
    static extension Make(extension e) => e;
}
