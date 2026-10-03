// roslyn: doc=diagnose
using System;

/// <summary>
/// Documented <see cref="Other{T}"/> type with &lt;entities&gt; &amp; &#65; &#x41; text.
/// </summary>
/// <typeparam name="T">The type.</typeparam>
/// <remarks attr='single' other = "spaced"  >Mixed <b>bold <i>nested</i></b> content.</remarks>
class Documented<T>
{
    /** Multi-line
     *  documentation <c>comment</c>
     *  <para>second</para>
     */
    int field;

    /// <param name="value">The value.</param>
    /// <paramref name="value"/> and <typeparamref name="T"/>
    /// <returns>A <see langword="null"/> result.</returns>
    /// <exception cref="System.ArgumentException">Thrown.</exception>
    int M(int value) => value;

    /// <see cref="M"/> <see cref="M(int)"/> <see cref="Documented{T}.M(int)"/> <see cref="System.Collections.Generic.List{T}"/>
    /// <see cref="Dictionary{TKey, TValue}.Add(TKey, TValue)"/> <see cref="M(ref int, out string, in long)"/>
    /// <see cref="this"/> <see cref="this[int]"/> <see cref="Documented{T}.this[int, string]"/>
    /// <see cref="operator +"/> <see cref="operator +(int, int)"/> <see cref="Documented{T}.operator -(Documented{T})"/>
    /// <see cref="operator checked +(int, int)"/> <see cref="operator &gt;&gt;(int, int)"/> <see cref="operator true"/>
    /// <see cref="implicit operator int"/> <see cref="explicit operator string(Documented{T})"/> <see cref="explicit operator checked int(long)"/>
    /// <see cref="int"/> <see cref="int.Parse(string)"/> <see cref="global::System.String"/> <see cref="M(int[], int?, int*, List{int}[])"/>
    /// <see cref='T:System.String'/> <see cref="M:System.String.Format(System.String)"/>
    void Crefs() { }

    /// <![CDATA[ raw <data> ]]> <!-- a comment --> <?pi target?>
    /// <code>
    ///   indented
    /// </code>
    void Other() { }

    /** single line doc */
    void Single() { }

    /**
      no stars
      second
    */
    void NoStars() { }
}
