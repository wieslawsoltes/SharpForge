int code=2;
string description=code switch { 1 => "one", 2 => "two", _ => "other" };
Console.WriteLine(description);
switch(code){case 1: Console.WriteLine("first"); break; case 2: case 3: Console.WriteLine("grouped case"); break; default: Console.WriteLine("default"); break;}
string fallback=null;
fallback ??= "assigned once";
Console.WriteLine(fallback);
Console.WriteLine((int)3.75);
Console.WriteLine(default(int));
Console.WriteLine(unchecked(2147483647 + 1));
