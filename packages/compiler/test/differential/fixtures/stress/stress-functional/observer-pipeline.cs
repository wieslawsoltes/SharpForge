using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Subject<T> : IObservable<T>, IObserver<T>
{
    private readonly List<IObserver<T>> observers = new List<IObserver<T>>();
    private bool completed;

    private sealed class Subscription : IDisposable
    {
        private readonly Subject<T> owner;
        private IObserver<T> observer;
        public Subscription(Subject<T> owner, IObserver<T> observer) { this.owner = owner; this.observer = observer; }
        public void Dispose()
        {
            if (observer == null) return;
            owner.observers.Remove(observer);
            observer = null;
        }
    }

    public IDisposable Subscribe(IObserver<T> observer)
    {
        if (completed) { observer.OnCompleted(); return new Subscription(this, null); }
        observers.Add(observer);
        return new Subscription(this, observer);
    }

    public void OnNext(T value) { foreach (var observer in observers.ToArray()) observer.OnNext(value); }
    public void OnError(Exception error) { foreach (var observer in observers.ToArray()) observer.OnError(error); observers.Clear(); completed = true; }
    public void OnCompleted() { foreach (var observer in observers.ToArray()) observer.OnCompleted(); observers.Clear(); completed = true; }
    public int ObserverCount => observers.Count;
}

public sealed class AnonymousObserver<T> : IObserver<T>
{
    private readonly Action<T> next;
    private readonly Action<Exception> error;
    private readonly Action done;
    public AnonymousObserver(Action<T> next, Action<Exception> error = null, Action done = null) { this.next = next; this.error = error; this.done = done; }
    public void OnNext(T value) => next(value);
    public void OnError(Exception e) => error?.Invoke(e);
    public void OnCompleted() => done?.Invoke();
}

public static class Observable
{
    private sealed class Operator<TIn, TOut> : IObservable<TOut>
    {
        private readonly IObservable<TIn> source;
        private readonly Func<IObserver<TOut>, IObserver<TIn>> wrap;
        public Operator(IObservable<TIn> source, Func<IObserver<TOut>, IObserver<TIn>> wrap) { this.source = source; this.wrap = wrap; }
        public IDisposable Subscribe(IObserver<TOut> observer) => source.Subscribe(wrap(observer));
    }

    public static IDisposable Subscribe<T>(this IObservable<T> source, Action<T> next, Action<Exception> error = null, Action done = null)
        => source.Subscribe(new AnonymousObserver<T>(next, error, done));

    public static IObservable<TOut> Select<TIn, TOut>(this IObservable<TIn> source, Func<TIn, TOut> map)
        => new Operator<TIn, TOut>(source, observer => new AnonymousObserver<TIn>(value =>
        {
            TOut mapped;
            try { mapped = map(value); }
            catch (Exception e) { observer.OnError(e); return; }
            observer.OnNext(mapped);
        }, observer.OnError, observer.OnCompleted));

    public static IObservable<T> Where<T>(this IObservable<T> source, Func<T, bool> predicate)
        => new Operator<T, T>(source, observer => new AnonymousObserver<T>(value => { if (predicate(value)) observer.OnNext(value); }, observer.OnError, observer.OnCompleted));

    public static IObservable<TState> Scan<T, TState>(this IObservable<T> source, TState seed, Func<TState, T, TState> fold)
        => new Operator<T, TState>(source, observer =>
        {
            TState state = seed;
            return new AnonymousObserver<T>(value => observer.OnNext(state = fold(state, value)), observer.OnError, observer.OnCompleted);
        });

    public static IObservable<IList<T>> Buffer<T>(this IObservable<T> source, int size)
        => new Operator<T, IList<T>>(source, observer =>
        {
            var buffer = new List<T>();
            return new AnonymousObserver<T>(value =>
            {
                buffer.Add(value);
                if (buffer.Count < size) return;
                var full = buffer;
                buffer = new List<T>();
                observer.OnNext(full);
            }, observer.OnError, () => { if (buffer.Count > 0) observer.OnNext(buffer); observer.OnCompleted(); });
        });

    public static IObservable<T> DistinctUntilChanged<T>(this IObservable<T> source)
        => new Operator<T, T>(source, observer =>
        {
            bool any = false;
            T last = default;
            return new AnonymousObserver<T>(value =>
            {
                if (any && EqualityComparer<T>.Default.Equals(last, value)) return;
                any = true;
                last = value;
                observer.OnNext(value);
            }, observer.OnError, observer.OnCompleted);
        });
}

public static class Program
{
    public static void Main()
    {
        var subject = new Subject<int>();
        var log = new List<string>();
        var evens = subject.Where(n => n % 2 == 0).Select(n => n * n).Subscribe(n => log.Add("even^2=" + n), done: () => log.Add("evens done"));
        var running = subject.Scan(0, (sum, n) => sum + n).Where(sum => sum > 5).Subscribe(sum => log.Add("sum=" + sum));
        var batches = subject.Select(n => (char)('a' + n)).Buffer(3).Subscribe(batch => log.Add("batch " + string.Concat(batch)), done: () => log.Add("batches done"));
        var changes = subject.Select(n => n / 3).DistinctUntilChanged().Subscribe(n => log.Add("third=" + n));
        var failing = subject.Select(n => 10 / (n - 4)).Subscribe(n => log.Add("div=" + n), e => log.Add("error " + e.GetType().Name));
        for (int i = 1; i <= 4; i++) subject.OnNext(i);
        Console.WriteLine(string.Join(", ", log) + " [" + subject.ObserverCount + "]");
        log.Clear();
        running.Dispose();
        running.Dispose();
        using (changes) { subject.OnNext(5); }
        subject.OnNext(6);
        subject.OnNext(7);
        Console.WriteLine(string.Join(", ", log) + " [" + subject.ObserverCount + "]");
        log.Clear();
        subject.OnCompleted();
        subject.OnNext(8);
        subject.Subscribe(n => log.Add("late " + n), done: () => log.Add("late done"));
        evens.Dispose();
        batches.Dispose();
        failing.Dispose();
        Console.WriteLine(string.Join(", ", log) + " [" + subject.ObserverCount + "]");

        var words = new Subject<string>();
        var lengths = new Subject<int>();
        var totals = new List<int>();
        words.Select(w => w.Length).Subscribe(lengths);
        lengths.Scan((Count: 0, Total: 0), (acc, n) => (acc.Count + 1, acc.Total + n)).Select(acc => acc.Total * 10 / acc.Count).Subscribe(totals.Add);
        foreach (var word in "reactive pipelines compose small operators".Split(' ')) words.OnNext(word);
        words.OnError(new TimeoutException());
        Console.WriteLine(string.Join(" ", totals) + " " + lengths.ObserverCount + " " + words.ObserverCount);
    }
}
