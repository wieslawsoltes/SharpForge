using System;
class Program {
    static ulong state=88172645463325252UL;
    static ulong Next(){state^=state<<13;state^=state>>7;state^=state<<17;return state;}
    static long Evaluate(int operation,long a,long b){
      ulong ua=unchecked((ulong)a);ulong ub=unchecked((ulong)b);int count=unchecked((int)b);
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
case 10:return unchecked((long)(ua/ub));
case 11:return unchecked((long)(ua%ub));
case 12:return unchecked((long)(ua>>count));
case 13:return checked(a+b);
case 14:return checked(a-b);
case 15:return checked(a*b);
case 16:return unchecked((long)checked(ua+ub));
case 17:return unchecked((long)checked(ua-ub));
case 18:return unchecked((long)checked(ua*ub));
case 19:return a==b?1L:0L;
case 20:return a!=b?1L:0L;
case 21:return a<b?1L:0L;
case 22:return a<=b?1L:0L;
case 23:return a>b?1L:0L;
case 24:return a>=b?1L:0L;
case 25:return ua<ub?1L:0L;
case 26:return ua<=ub?1L:0L;
case 27:return ua>ub?1L:0L;
case 28:return ua>=ub?1L:0L;default:return 0L;}
    }
    static void Main(){
      for(int i=0;i<100000;i++){
        long a=unchecked((long)Next());long b=unchecked((long)Next());
        switch(i){case 0:a=0L;b=0L;break;
case 1:a=1L;b=0L;break;
case 2:a=-1L;b=0L;break;
case 3:a=long.MinValue;b=-1L;break;
case 4:a=9223372036854775807L;b=1L;break;
case 5:a=-1L;b=-1L;break;
case 6:a=1L;b=64L;break;
case 7:a=-1L;b=65L;break;
case 8:a=1L;b=-1L;break;
case 9:a=0L;b=1L;break;
case 10:a=4294967296L;b=4294967296L;break;}
        for(int operation=0;operation<29;operation++){
          try{Console.WriteLine(Evaluate(operation,a,b));}
          catch(Exception error){Console.WriteLine("!"+error.GetType().Name);}
        }
      }
    }
  }