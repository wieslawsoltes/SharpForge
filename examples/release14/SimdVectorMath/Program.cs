using System.Numerics;
Vector<int> a = new(2);
Vector<int> b = new(3);
Console.WriteLine(Vector.Sum(a + b));
Console.WriteLine(Vector.Dot(new Vector<int>(2), new Vector<int>(4)));
var x = new Vector<double>(new double[] { 3.0, 4.0 });
Console.WriteLine(Vector.Sum(x * new Vector<double>(2.0)));
