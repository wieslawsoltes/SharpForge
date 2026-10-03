using System;
using System.Collections.Generic;

List<int> values = [with(capacity:20), 1, 2, 3];
Console.WriteLine(values.Capacity);
Console.WriteLine(values.Count);
