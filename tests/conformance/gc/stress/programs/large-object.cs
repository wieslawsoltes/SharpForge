using System;
class Program { static void Main() { int[] values=new int[90000]; values[0]=42; values[89999]=53; string[] pressure=new string[8]; for(int i=0;i<8;i++) pressure[i]="p"+i; Console.WriteLine(values.Length); Console.WriteLine(values[0]+values[89999]); } }
