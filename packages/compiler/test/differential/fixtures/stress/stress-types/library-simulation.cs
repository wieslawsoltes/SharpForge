using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Library
{
    public enum Genre { Fiction, Science, History, Children }
    public enum LoanState { Active, Returned, Overdue }

    public interface IEvent { DateTime At { get; } string Describe(); }
    public abstract record LibraryEvent(DateTime At) : IEvent
    {
        public abstract string Describe();
        public sealed override string ToString() => $"{At:MM-dd} {Describe()}";
    }
    public sealed record Borrowed(DateTime At, string Member, string Title) : LibraryEvent(At) { public override string Describe() => $"{Member} borrowed '{Title}'"; }
    public sealed record Returned(DateTime At, string Member, string Title, decimal Fine) : LibraryEvent(At)
    {
        public override string Describe() => $"{Member} returned '{Title}'" + (Fine > 0 ? " fine " + Fine.ToString("0.00", CultureInfo.InvariantCulture) : "");
    }
    public sealed record Refused(DateTime At, string Member, string Title, string Reason) : LibraryEvent(At) { public override string Describe() => $"{Member} refused '{Title}': {Reason}"; }

    public sealed class Book : IEquatable<Book>
    {
        public Book(string isbn, string title, Genre genre, int copies) { Isbn = isbn; Title = title; Genre = genre; Copies = Available = copies; }
        public string Isbn { get; }
        public string Title { get; }
        public Genre Genre { get; }
        public int Copies { get; }
        public int Available { get; internal set; }
        public bool Equals(Book other) => other != null && Isbn == other.Isbn;
        public override bool Equals(object obj) => Equals(obj as Book);
        public override int GetHashCode() => Isbn.GetHashCode();
    }

    public abstract class Member
    {
        protected Member(string name) { Name = name; }
        public string Name { get; }
        public List<Loan> Loans { get; } = new List<Loan>();
        public decimal Fines { get; internal set; }
        public abstract int Limit { get; }
        public virtual int LoanDays => 14;
        public virtual decimal FinePerDay => 0.25m;
        public virtual bool MayBorrow(Book book, out string reason)
        {
            reason = Loans.Count(l => l.State != LoanState.Returned) >= Limit ? "limit reached" : Fines > 5 ? "unpaid fines" : null;
            return reason == null;
        }
    }

    public sealed class Adult : Member
    {
        public Adult(string name) : base(name) { }
        public override int Limit => 3;
    }

    public sealed class Child : Member
    {
        public Child(string name) : base(name) { }
        public override int Limit => 2;
        public override int LoanDays => 7;
        public override decimal FinePerDay => 0.05m;
        public override bool MayBorrow(Book book, out string reason)
        {
            if (book.Genre is not (Genre.Children or Genre.Science)) { reason = "not for children"; return false; }
            return base.MayBorrow(book, out reason);
        }
    }

    public sealed class Loan
    {
        public Loan(Book book, DateTime from, int days) { Book = book; From = from; Due = from.AddDays(days); }
        public Book Book { get; }
        public DateTime From { get; }
        public DateTime Due { get; }
        public DateTime? ReturnedAt { get; set; }
        public LoanState State => ReturnedAt.HasValue ? LoanState.Returned : Catalog.Today > Due ? LoanState.Overdue : LoanState.Active;
    }

    public sealed class Catalog
    {
        public static DateTime Today { get; set; } = new DateTime(2024, 3, 1);
        private readonly Dictionary<string, Book> books = new Dictionary<string, Book>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, Member> members = new Dictionary<string, Member>();
        private readonly List<IEvent> events = new List<IEvent>();
        public event Action<IEvent> Happened;

        public Catalog Add(params Book[] added) { foreach (var book in added) books[book.Title] = book; return this; }
        public Catalog Join(params Member[] joined) { foreach (var member in joined) members[member.Name] = member; return this; }
        public IReadOnlyList<IEvent> Events => events;
        public IEnumerable<Member> Members => members.Values;
        public IEnumerable<Book> Books => books.Values;

        private void Publish(IEvent e) { events.Add(e); Happened?.Invoke(e); }

        public bool Borrow(string memberName, string title)
        {
            var member = members[memberName];
            if (!books.TryGetValue(title, out var book)) { Publish(new Refused(Today, memberName, title, "unknown title")); return false; }
            string reason = book.Available == 0 ? "no copies left" : member.Loans.Any(l => l.Book.Equals(book) && l.State != LoanState.Returned) ? "already borrowed" : null;
            if (reason != null || !member.MayBorrow(book, out reason)) { Publish(new Refused(Today, memberName, book.Title, reason)); return false; }
            book.Available--;
            member.Loans.Add(new Loan(book, Today, member.LoanDays));
            Publish(new Borrowed(Today, memberName, book.Title));
            return true;
        }

        public decimal Return(string memberName, string title)
        {
            var member = members[memberName];
            var loan = member.Loans.First(l => l.Book.Title.Equals(title, StringComparison.OrdinalIgnoreCase) && l.State != LoanState.Returned);
            int late = Math.Max(0, (Today - loan.Due).Days);
            decimal fine = late * member.FinePerDay;
            loan.ReturnedAt = Today;
            loan.Book.Available++;
            member.Fines += fine;
            Publish(new Returned(Today, memberName, loan.Book.Title, fine));
            return fine;
        }
    }

    public static class Program
    {
        public static void Main()
        {
            var catalog = new Catalog()
                .Add(new Book("1", "Dune", Genre.Fiction, 1), new Book("2", "Cosmos", Genre.Science, 2), new Book("3", "SPQR", Genre.History, 1), new Book("4", "Matilda", Genre.Children, 1), new Book("5", "Emma", Genre.Fiction, 1))
                .Join(new Adult("Ada"), new Adult("Bob"), new Child("Cy"));
            int refusals = 0;
            catalog.Happened += e => { if (e is Refused) refusals++; };
            var script = new (int Day, string Member, string Title, bool Return)[]
            {
                (0, "Ada", "dune", false), (0, "Bob", "Dune", false), (1, "Cy", "Emma", false), (1, "Cy", "Matilda", false), (2, "Cy", "Cosmos", false), (2, "Cy", "SPQR", false),
                (3, "Ada", "Cosmos", false), (3, "Ada", "SPQR", false), (4, "Ada", "Emma", false), (4, "Ada", "Dune", false), (5, "Bob", "Atlas", false), (12, "Cy", "Matilda", true),
                (30, "Ada", "Dune", true), (30, "Bob", "Dune", false), (31, "Ada", "Emma", false), (40, "Ada", "SPQR", true), (41, "Ada", "Emma", false), (41, "Cy", "Cosmos", true),
            };
            var start = Catalog.Today;
            decimal collected = 0;
            foreach (var (day, member, title, isReturn) in script)
            {
                Catalog.Today = start.AddDays(day);
                if (isReturn) collected += catalog.Return(member, title); else catalog.Borrow(member, title);
            }
            foreach (var e in catalog.Events) Console.WriteLine(e);
            Console.WriteLine($"{catalog.Events.Count} events, {refusals} refusals, fines {collected.ToString("0.00", CultureInfo.InvariantCulture)}");
            foreach (var member in catalog.Members.OrderBy(m => m.Name))
            {
                var states = member.Loans.GroupBy(l => l.State).OrderBy(g => g.Key).Select(g => g.Key + "=" + string.Join("/", g.Select(l => l.Book.Title)));
                Console.WriteLine($"{member.Name,-4}{member.GetType().Name,-6}{member.Fines,6:F2} {string.Join(" ", states)}");
            }
            var summary = new StringBuilder();
            foreach (var group in catalog.Books.GroupBy(b => b.Genre).OrderBy(g => g.Key))
                summary.Append(group.Key).Append('[').Append(string.Join(",", group.OrderBy(b => b.Title).Select(b => $"{b.Title} {b.Available}/{b.Copies}"))).Append("] ");
            Console.WriteLine(summary.ToString().TrimEnd());
            var byKind = catalog.Events.GroupBy(e => e.GetType().Name).ToDictionary(g => g.Key, g => g.Count());
            var busiest = catalog.Events.OfType<Borrowed>().GroupBy(b => b.Title).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).First();
            Console.WriteLine(string.Join(" ", byKind.OrderBy(p => p.Key).Select(p => p.Key + "=" + p.Value)) + " busiest " + busiest.Key + " x" + busiest.Count() + " " + (catalog.Events[0] is Borrowed { Member: "Ada" } first && first == new Borrowed(start, "Ada", "Dune")));
        }
    }
}
