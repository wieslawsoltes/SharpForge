// leading comment
/* block */ using System; // trailing comment
/* a */ /* b */

/// <summary>
/// Documented <see cref="Other{T}"/> type.
/// </summary>
/// <typeparam name="T">The type.</typeparam>
class Documented<T> // after name
{
    /** Multi-line
     *  documentation <c>comment</c>
     */
    int field; /* trailing block */ // and line

    //// not documentation
    /**/ int empty;
    /***/ int stars;
    void M() /* before body */
    {   // after brace
        int x = 1 /* inside */ + /* between */ 2; // end

        // own line
        x++; /// trailing doc-looking comment
        /* multi
           line */ x--;
    }
	// tab-indented comment
}
// final comment without newline