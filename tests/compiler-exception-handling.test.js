/**
 * SF-A02-T44: catch clauses of any exception type. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/exception-handling.js; these tests cover the exception class
 * hierarchy the binder knows and what code generation says about the handlers the runtime cannot run yet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program {\n${body}\n}\n`;
const codes = (source, severity = 'error') =>
  compile(source)
    .diagnostics.filter(d => d.severity === severity && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);

test('SF-A02-T44 catch clauses are ordered by the inheritance of the exception classes (CS0160)', () => {
  const source = program(`
    static void Main() {
      try { }
      catch (ArithmeticException) { }
      catch (DivideByZeroException) { }
      catch (SystemException) { }
      catch (OverflowException) { }
      catch (System.IO.IOException) { }
      catch (ApplicationException) { }
      catch (Exception) { }
    }`);
  assert.deepEqual(codes(source), ['CS0160 DivideByZeroException', 'CS0160 OverflowException', 'CS0160 System.IO.IOException']);
  const message = compile(source).diagnostics.find(d => d.code === 'CS0160').message;
  assert.equal(message, "A previous catch clause already catches all exceptions of this or of a super type ('System.ArithmeticException')");
});

test('SF-A02-T44 nothing follows a general catch clause (CS1017); a general clause after catch (Exception) is CS1058', () => {
  const source = program(`
    static void Main() {
      try { } catch (Exception) { } catch { }
      try { } catch { } catch (Exception) { }
    }`);
  assert.deepEqual(codes(source), ['CS1017 catch']);
  assert.deepEqual(codes(source, 'warning'), ['CS1058 catch']);
});

test('SF-A02-T44 a filtered clause does not hide later clauses, but an earlier unfiltered one hides it', () => {
  const source = program(`
    static void Main() {
      int n = 0;
      try { } catch (ArgumentException) when (n > 0) { } catch (ArgumentException) { } catch (ArgumentNullException) when (n > 1) { }
    }`);
  assert.deepEqual(codes(source), ['CS0160 ArgumentNullException']);
});

test('SF-A02-T44 a class deriving from Exception binds: implicit base constructor, base(message), InnerException', () => {
  const source = `
    using System;
    class Plain : Exception { }
    class Wrapped : InvalidOperationException {
      public Wrapped(string message, Exception inner) : base(message, inner) { }
    }
    class Program {
      static string Describe(Exception error) {
        return error.Message + (error.InnerException != null ? " <- " + error.InnerException.Message : "");
      }
      static void Main() {
        Exception a = new Plain();
        Exception b = new Wrapped("outer", new ArgumentNullException("value"));
        Console.WriteLine(Describe(a) + Describe(b) + new ArgumentException("m", "p").ParamName);
      }
    }`;
  assert.deepEqual(codes(source), []);
});

test('SF-A02-T44 the constructors of the exception classes bind with their System.Runtime shapes', () => {
  const source = program(`
    static void Main() {
      Exception[] all = new Exception[] {
        new Exception(), new Exception("m"), new Exception("m", null),
        new ArgumentException("m", "p"), new ArgumentNullException("p"), new ArgumentOutOfRangeException("p", 3, "m"),
        new ObjectDisposedException("name"), new System.Collections.Generic.KeyNotFoundException("m"),
        new System.IO.FileNotFoundException("m", new System.IO.IOException()),
      };
      Console.WriteLine(all.Length);
    }`);
  assert.deepEqual(codes(source), []);
  // Valid C#, analysed completely: the only diagnostic is what the runtime cannot do.
  assert.match(notExecutable(source).message, /creates System\.Exception only|not in the framework registry/);
});

test('SF-A02-T44 catch (Exception), general catch, rethrow and finally execute on both back ends', () => {
  const lines = linesOf(`
    using System;
    delegate void Marker();
    class Program {
      static void Main() {
        try {
          try { throw new Exception("first"); }
          catch (Exception e) { Console.WriteLine("caught " + e.Message); throw; }
          finally { Console.WriteLine("finally"); }
        }
        catch { Console.WriteLine("general"); }
      }
    }`);
  assert.deepEqual(lines, ['caught first', 'finally', 'general']);
});

test('SF-A02-T44 a typed handler is valid C# the runtime cannot run: one SF2200 on the caught type', () => {
  const source = program(`
    static void Main() {
      try { Console.WriteLine(1); }
      catch (FormatException) { Console.WriteLine(2); }
    }`);
  assert.deepEqual(codes(source), []);
  const reported = notExecutable(source);
  assert.match(reported.message, /a catch clause for 'System\.FormatException' \(the runtime catches System\.Exception only\)/);
  assert.equal(source.slice(reported.start, reported.start + reported.length), 'FormatException');
});

test('SF-A02-T44 creating another exception class is reported, not turned into System.Exception', () => {
  const source = program(`
    static void Main() {
      try { throw new InvalidOperationException("state"); }
      catch (Exception e) { Console.WriteLine(e.Message); }
    }`);
  assert.deepEqual(codes(source), []);
  const reported = notExecutable(source);
  assert.match(reported.message, /exception class 'System\.InvalidOperationException' \(the runtime creates System\.Exception only\)/);
});
