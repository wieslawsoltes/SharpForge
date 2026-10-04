import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToReferenceAssembly } from '@sharpforge/compiler';
import { MetadataView, findType, extensionMarker } from './fixtures/exported-extension-blocks/metadata.mjs';

const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d => `${d.code}: ${d.message}`);

function markerTokens(source, names) {
  const result = compileToReferenceAssembly(source, { name: 'MarkerIdentities', outputKind: 'library', langVersion: '14' });
  assert.deepEqual(errors(result), []);
  const view = new MetadataView(result.assembly), owner = findType(view, 'Extensions');
  const markers = names.map(name => extensionMarker(view, owner, name));
  assert.equal(new Set(markers.map(entry => entry.group)).size, 1, 'attributes do not change the receiver CLR type');
  return markers.map(entry => entry.marker);
}

test('A02-T83 marker identity preserves the enum type of a boxed receiver attribute argument', () => {
  const markers = markerTokens(`using System;
    public enum First { Zero } public enum Second { Zero }
    public sealed class TagAttribute : Attribute { public TagAttribute(object value) { } }
    public static class Extensions {
      extension([Tag(First.Zero)] int number) { public int A() => number; }
      extension([Tag(Second.Zero)] int number) { public int B() => number; }
      extension([Tag(First.Zero)] int number) { public int C() => number; }
    }`, ['A', 'B', 'C']);
  assert.notEqual(markers[0], markers[1]);
  assert.equal(markers[0], markers[2]);
});

test('A02-T83 marker identity preserves nonfinite doubles and signed zero in receiver attributes', () => {
  const markers = markerTokens(`using System;
    public sealed class TagAttribute : Attribute { public TagAttribute(double value) { } }
    public static class Extensions {
      extension([Tag(double.NaN)] int number) { public int A() => number; }
      extension([Tag(double.PositiveInfinity)] int number) { public int B() => number; }
      extension([Tag(0.0)] int number) { public int C() => number; }
      extension([Tag(-0.0)] int number) { public int D() => number; }
    }`, ['A', 'B', 'C', 'D']);
  assert.equal(new Set(markers).size, 4);
});

test('A02-T83 an unbound generic typeof receiver attribute has a finite and distinct marker identity', () => {
  const markers = markerTokens(`using System;
    public class Box<T> { }
    public sealed class TagAttribute : Attribute { public TagAttribute(Type value) { } }
    public static class Extensions {
      extension([Tag(typeof(Box<>))] int number) { public int A() => number; }
      extension([Tag(typeof(Box<int>))] int number) { public int B() => number; }
    }`, ['A', 'B']);
  assert.notEqual(markers[0], markers[1]);
});

test('A02-T83 marker identity preserves a selected attribute constructor and boxed constant type', () => {
  const markers = markerTokens(`using System;
    public sealed class TagAttribute : Attribute { public TagAttribute(int value) { } public TagAttribute(object value) { } }
    public static class Extensions {
      extension([Tag(1)] int number) { public int A() => number; }
      extension([Tag((object)1)] int number) { public int B() => number; }
    }`, ['A', 'B']);
  assert.notEqual(markers[0], markers[1]);
});

test('A02-T83 marker identity preserves the element type of an empty boxed attribute array', () => {
  const markers = markerTokens(`using System;
    public sealed class TagAttribute : Attribute { public TagAttribute(object value) { } }
    public static class Extensions {
      extension([Tag(new int[] { })] int number) { public int A() => number; }
      extension([Tag(new string[] { })] int number) { public int B() => number; }
    }`, ['A', 'B']);
  assert.notEqual(markers[0], markers[1]);
});
