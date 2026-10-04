using System;
class Program
{
    static void Main()
    {
        try
        {
            try { throw new Exception("first"); }
            finally { throw new Exception("second"); }
        }
        // First-pass search must select a handler before the inner finally runs.
        // Rethrowing preserves a terminal fault for the fault-transfer fixture.
        catch (Exception) { throw; }
    }
}
