using NativeExample;
var data = new[] { 10, 20, 12 };
Console.WriteLine($"Native MSBuild: {Numbers.Sum(data, x => x)} / generated {BuildTag.Answer}");
