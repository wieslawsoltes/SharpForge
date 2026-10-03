struct S<T> where T:unmanaged { public T Value; } class C { static void F<T>() where T:unmanaged {} void M(){F<S<int>>();} }
