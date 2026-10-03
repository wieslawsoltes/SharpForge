using System;
class Program { static void Main() { string[] keep=new string[16]; for(int i=0;i<16;i++) keep[i]="value"+i; Console.WriteLine(keep[0]); Console.WriteLine(keep[15]); Console.WriteLine(new object[0].Length); } }
