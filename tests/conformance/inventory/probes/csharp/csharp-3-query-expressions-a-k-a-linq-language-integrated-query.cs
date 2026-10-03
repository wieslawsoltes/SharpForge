using System.Linq; class C { object M(int[] xs){return from x in xs where x>0 select x+1;} }
