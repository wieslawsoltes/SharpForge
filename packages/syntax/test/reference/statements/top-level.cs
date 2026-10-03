using System;
using var resource = Open();

Console.WriteLine("top");
int Add(int x, int y) => x + y;
static void Helper() { }
var total = Add(1, 2);
[Obsolete] void Marked() { }
await Task.Delay(1);
[1, 2, 3].ToString();
if (total > 2) return 1;
return 0;

class After { }
struct AlsoAfter { }
