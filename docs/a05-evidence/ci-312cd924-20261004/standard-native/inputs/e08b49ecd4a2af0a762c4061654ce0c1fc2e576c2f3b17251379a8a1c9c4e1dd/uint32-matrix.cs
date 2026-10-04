using System;
class Program {
    static int Value(int index){switch(index){case 0:return 0;case 1:return 1;
      case 2:return int.MaxValue;case 3:return int.MinValue;default:return -1;}}
    static int Evaluate(int operation,int a,int b){
      uint ua=unchecked((uint)a);uint ub=unchecked((uint)b);int count=b;
      switch(operation){case 0:return unchecked(a+b);
case 1:return unchecked(a-b);
case 2:return unchecked(a*b);
case 3:return a/b;
case 4:return a%b;
case 5:return a<<count;
case 6:return a>>count;
case 7:return a&b;
case 8:return a|b;
case 9:return a^b;
case 10:return unchecked((int)(ua/ub));
case 11:return unchecked((int)(ua%ub));
case 12:return unchecked((int)(ua>>count));
case 13:return checked(a+b);
case 14:return checked(a-b);
case 15:return checked(a*b);
case 16:return unchecked((int)checked(ua+ub));
case 17:return unchecked((int)checked(ua-ub));
case 18:return unchecked((int)checked(ua*ub));
case 19:return a==b?1:0;
case 20:return a!=b?1:0;
case 21:return a<b?1:0;
case 22:return a<=b?1:0;
case 23:return a>b?1:0;
case 24:return a>=b?1:0;
case 25:return ua<ub?1:0;
case 26:return ua<=ub?1:0;
case 27:return ua>ub?1:0;
case 28:return ua>=ub?1:0;default:return 0;}
    }
    static void Main(){for(int left=0;left<5;left++){for(int right=0;right<5;right++){
      int a=Value(left);int b=Value(right);
      for(int operation=0;operation<29;operation++){
        try{Console.WriteLine(Evaluate(operation,a,b));}
        catch(Exception error){Console.WriteLine("!"+error.GetType().Name);}
      }
    }}}
  }