using System;
interface IBase { int Value() => 1; }
interface ILeft : IBase { int IBase.Value() => 2; }
interface IRight : IBase { int IBase.Value() => 3; }
interface ILeaf : ILeft, IRight { int IBase.Value() => 4; }
class Default : IBase { }
class Specific : ILeaf { }
class Implicit : ILeaf { public int Value() => 5; }
class Explicit : ILeaf { int IBase.Value() => 6; }
class Reimplemented : Default, IBase { public int Value() => 7; }
class Program
{
    static void Print(IBase value) => Console.WriteLine(value.Value());
    static void Main()
    {
        Print(new Default());
        Print(new Specific());
        Print(new Implicit());
        Print(new Explicit());
        Print(new Reimplemented());
    }
}
