using System;
using System.Text;

var builder = new StringBuilder("BCL modules: ");
builder.AppendFormat("{0:D3}", int.Parse("42"));
Console.WriteLine(builder.ToString());
Console.WriteLine("Array and Random".Substring(0, 5));
var values = new int[3];
Array.Fill(values, new Random(42).Next(10));
Console.WriteLine(string.Join(",", values));
