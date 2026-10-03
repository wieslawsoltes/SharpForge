class C
{
    void M(int i)
    {
        var a = i switch { 1 => 2 2 => 3 };
        var b = i switch { 1 => , _ => 3 };
        var c = i switch { 1 2, _ => 3 };
        var d = i switch { => 1 };
        var f = i switch { 1 => 2, _ => 3
    }
}
