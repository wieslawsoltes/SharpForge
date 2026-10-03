using System.Collections.Generic;
var stock = new Dictionary<string,int>() { {"pencils",10}, {"books",5} };
stock["pencils"] += 2;
int total = 0;
foreach (var key in stock.Keys) { Console.WriteLine($"{key}: {stock[key]}"); total += stock[key]; }
Console.WriteLine($"Total: {total:D2}");
