using System;
class Program { static void Main() { try { throw new Exception("retained-fault"); } catch(Exception error) { string[] pressure=new string[8]; for(int i=0;i<8;i++) pressure[i]="p"+i; Console.WriteLine(error.Message); } } }
