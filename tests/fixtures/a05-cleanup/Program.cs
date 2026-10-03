using System;
class Program {
    static int ReturnThroughThree() {
        try {
            try {
                try { return 42; }
                finally { Console.WriteLine("inner"); }
            } finally { Console.WriteLine("middle"); }
        } finally { Console.WriteLine("outer"); }
    }
    static void LeaveCatch() {
        try {
            try { throw new Exception("caught"); }
            catch (Exception error) { Console.WriteLine(error.Message); }
        } finally { Console.WriteLine("catch-finally"); }
    }
    static void Replace() {
        try {
            try {
                try { throw new Exception("original"); }
                finally { Console.WriteLine("replace"); throw new Exception("replacement"); }
            } finally { Console.WriteLine("replace-middle"); }
        } finally { Console.WriteLine("replace-outer"); }
    }
    static void Main() {
        Console.WriteLine(ReturnThroughThree());
        LeaveCatch();
        try { Replace(); }
        catch (Exception error) { Console.WriteLine(error.Message); }
    }
}
