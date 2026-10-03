using System;
using System.Collections.Generic;
class Tries
{
    void M()
    {
        try { A(); } catch (InvalidOperationException) { B(); }
        try { A(); } catch (InvalidOperationException e) { B(e); }
        try { A(); } catch { B(); }
        try { A(); } catch (ArgumentNullException e) { } catch (ArgumentException) { } catch (System.IO.IOException e) { throw; } catch { throw new Exception(); }
        try { A(); } finally { C(); }
        try { A(); } catch (Exception e) { B(e); } finally { C(); }
        try { try { A(); } finally { C(); } } catch (global::System.Exception) { }
        try { } catch (Exception e) when (e.Message != null) { } catch when (Flag) { }
        try { } catch (List<int>.Enumerator e) { } catch (int[] e) { }
        try
        {
            A();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("x", ex);
        }
        finally
        {
            try { C(); } catch { }
        }
    }
}
