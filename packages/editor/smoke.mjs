import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'editor:stylesheet', order: 670, async run(context) {
    const {readFileSync}=await import('node:fs');
    const entry = new URL(import.meta.resolve('@sharpforge/editor/editor.css'));
    const styles = [readFileSync(entry, 'utf8')];
    for (const match of styles[0].matchAll(/@import\s+['"]([^'"]+)['"]/gu)) {
      const imported = readFileSync(new URL(match[1], entry), 'utf8');
      assert(imported.length > 0, `Empty bundled editor stylesheet: ${match[1]}`);
      styles.push(imported);
    }
    assert(styles.some(text => text.includes('.sf-editor')));
    Object.assign(context, {readFileSync});
  }},
  {id: 'editor:viewport-navigation', order: 890, async run(context) {
    const {SyntaxHighlightIndex,NavigationHistory}=await import('@sharpforge/editor');
    const index=new SyntaxHighlightIndex('int x=1;\n'.repeat(5000)),view=index.window({scrollTop:22000,height:440});
    assert(view.characters<1000);
    assert(view.firstLine>900);
    const history=new NavigationHistory();
    history.push({uri:'A.cs',start:1,end:1});
    history.push({uri:'B.cs',start:2,end:4});
    assert.equal(history.back().uri,'A.cs');
  }},
  {id: 'editor:keymaps-classic-css', order: 1120, async run(context) {
    const {readFileSync} = context;
    const {EDITOR_KEYMAPS}=await import('@sharpforge/editor');
    assert.equal(EDITOR_KEYMAPS.length,6);
    assert.equal(EDITOR_KEYMAPS[0].id,'visual-studio');
    assert(EDITOR_KEYMAPS.some(profile=>profile.id==='resharper'));
    assert(readFileSync(new URL(import.meta.resolve('@sharpforge/editor/classic.css')),'utf8').includes('.CodeMirror'));
  }},
];
