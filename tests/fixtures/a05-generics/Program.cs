using System;
sealed class ListLike<T> {
    private T value;
    public ListLike(T initial) { value = initial; }
    public T Read() { return value; }
}
sealed class DictionaryShape<K, V> {
    public K Key;
    public V Value;
    public DictionaryShape(K key, V value) { Key = key; Value = value; }
}
static class Program {
    static T Identity<T>(T value) { return value; }
    static T Default<T>() { return default(T); }
    static Type Type<T>() { return typeof(T); }
    static void Main() {
        var integers = new ListLike<int>(42);
        var strings = new ListLike<string>("reference");
        var nested = new DictionaryShape<int, ListLike<string>>(7, strings);
        Console.WriteLine(integers.Read());
        Console.WriteLine(Identity<string>(nested.Value.Read()));
        Console.WriteLine(Identity<int>(nested.Key));
        Console.WriteLine(Default<int>());
        Console.WriteLine(Default<string>() == null);
        Console.WriteLine(Type<int>() == typeof(int));
        Console.WriteLine(Type<string>() == typeof(string));
    }
}
