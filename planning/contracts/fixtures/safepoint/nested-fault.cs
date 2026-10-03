using System;
class Program { static void Main() { try { throw new Exception("first"); } finally { throw new Exception("second"); } } }
