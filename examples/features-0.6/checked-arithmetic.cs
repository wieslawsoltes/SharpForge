int maximum = 2147483647;
try { checked { Console.WriteLine(maximum + 1); } }
catch (Exception error) { Console.WriteLine("addition overflow"); }
int factor = 50000;
try { Console.WriteLine(checked(factor * factor)); }
catch (Exception error) { Console.WriteLine("multiplication overflow"); }
checked { Console.WriteLine(unchecked(maximum + 1)); }
double outside = 2147483648.0;
try { Console.WriteLine(checked((int)outside)); }
catch (Exception error) { Console.WriteLine("conversion overflow"); }
