using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Stress.Repository
{
    public interface IEntity<TKey> where TKey : IEquatable<TKey>
    {
        TKey Id { get; }
    }

    public interface IRepository<TEntity, TKey> where TEntity : class, IEntity<TKey> where TKey : IEquatable<TKey>
    {
        void Add(TEntity entity);
        bool TryGet(TKey id, out TEntity entity);
        IEnumerable<TEntity> Query(Func<TEntity, bool> predicate);
        Task<int> SaveAsync();
        int Count { get; }
    }

    public abstract class EntityBase : IEntity<int>
    {
        private static int nextId = 1;
        protected EntityBase() { Id = nextId++; }
        public int Id { get; }
        public abstract string Describe();
        public override string ToString() => $"#{Id} {Describe()}";
    }

    public class Customer : EntityBase
    {
        public string Name { get; set; }
        public string City { get; set; }
        public decimal Balance { get; set; }
        public override string Describe() => $"{Name} ({City}) {Balance:F2}";
    }

    public sealed class VipCustomer : Customer
    {
        public int Level { get; set; }
        public override string Describe() => base.Describe() + " VIP" + Level;
    }

    public class MemoryRepository<TEntity, TKey> : IRepository<TEntity, TKey>
        where TEntity : class, IEntity<TKey>
        where TKey : IEquatable<TKey>
    {
        private readonly Dictionary<TKey, TEntity> items = new Dictionary<TKey, TEntity>();
        private readonly List<TEntity> pending = new List<TEntity>();

        public int Count => items.Count;

        public void Add(TEntity entity)
        {
            if (entity == null) throw new ArgumentNullException(nameof(entity));
            pending.Add(entity);
        }

        public bool TryGet(TKey id, out TEntity entity) => items.TryGetValue(id, out entity);

        public IEnumerable<TEntity> Query(Func<TEntity, bool> predicate)
        {
            foreach (var pair in items)
            {
                if (predicate(pair.Value)) yield return pair.Value;
            }
        }

        public async Task<int> SaveAsync()
        {
            int saved = 0;
            foreach (var entity in pending)
            {
                await Task.Yield();
                if (!items.ContainsKey(entity.Id))
                {
                    items[entity.Id] = entity;
                    saved++;
                }
            }
            pending.Clear();
            return saved;
        }
    }

    public static class RepositoryExtensions
    {
        public static IEnumerable<TResult> Project<TEntity, TKey, TResult>(
            this IRepository<TEntity, TKey> repository, Func<TEntity, TResult> selector)
            where TEntity : class, IEntity<TKey>
            where TKey : IEquatable<TKey>
        {
            return repository.Query(_ => true).Select(selector);
        }
    }

    public static class Program
    {
        public static async Task<int> Main()
        {
            IRepository<Customer, int> repository = new MemoryRepository<Customer, int>();
            repository.Add(new Customer { Name = "Ada", City = "London", Balance = 120.5m });
            repository.Add(new VipCustomer { Name = "Grace", City = "New York", Balance = 990m, Level = 3 });
            repository.Add(new Customer { Name = "Linus", City = "Helsinki", Balance = -15.25m });
            repository.Add(new Customer { Name = "Alan", City = "London", Balance = 42m });
            repository.Add(new VipCustomer { Name = "Edsger", City = "Austin", Balance = 0m, Level = 1 });

            Console.WriteLine("before save: " + repository.Count);
            int saved = await repository.SaveAsync();
            Console.WriteLine($"saved {saved}, count {repository.Count}, again {await repository.SaveAsync()}");

            foreach (var customer in repository.Query(c => c.Balance > 0).OrderByDescending(c => c.Balance))
                Console.WriteLine(customer);

            var byCity = repository.Query(c => true)
                .GroupBy(c => c.City)
                .Select(g => new { City = g.Key, Total = g.Sum(c => c.Balance), Names = string.Join(",", g.Select(c => c.Name).OrderBy(n => n)) })
                .OrderBy(x => x.City);
            foreach (var row in byCity) Console.WriteLine($"{row.City,-10}|{row.Total,8:F2}|{row.Names}");

            var vips = repository.Query(c => c is VipCustomer).Cast<VipCustomer>().ToDictionary(v => v.Name, v => v.Level);
            foreach (var pair in vips.OrderBy(p => p.Key)) Console.WriteLine(pair.Key + "=" + pair.Value);

            if (repository.TryGet(3, out var found)) Console.WriteLine("found " + found.Name);
            Console.WriteLine(repository.TryGet(99, out var missing) ? "unexpected" : "missing is null: " + (missing == null));

            var lengths = repository.Project<Customer, int, (string Name, int Length)>(c => (c.Name, c.Name.Length));
            Console.WriteLine(string.Join(" ", lengths.Where(t => t.Length > 3).Select(t => t.Name + ":" + t.Length)));

            var query = from c in repository.Query(c => true)
                        where c.City.Length > 5
                        let initial = c.Name[0]
                        orderby initial descending, c.Balance
                        select $"{initial}{c.Id}";
            Console.WriteLine(string.Join("/", query));

            try { repository.Add(null); }
            catch (ArgumentNullException e) { Console.WriteLine("rejected " + e.ParamName); }
            return repository.Count;
        }
    }
}
