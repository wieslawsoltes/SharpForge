import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'designer:scene-patch', order: 1790, async run(context) {
    const {compileToIL, vm, CilDebugSession, ds, DebugSession} = context;
    const {createDesign,DesignDocument,generateDesignProject,designFromScene,designPatch}=await import('@sharpforge/designer');
    const {applyDesignPatch}=await import('@sharpforge/runtime');
    const design=new DesignDocument(createDesign('Packaged designer'));
    design.add('NumberBox','canvas',{Value:42});
    const dc=compileToIL(generateDesignProject(design.value).filter(r=>r.path.endsWith('.cs')).map(r=>({uri:r.path,text:r.text})));
    assert(dc.success,JSON.stringify(dc.diagnostics));
    for(const Session of [DebugSession,CilDebugSession]){const ds=new Session(Session===DebugSession?dc.image:dc.assembly);ds.start(false);ds.runUntilStop();const prior=designFromScene(ds.vm.platform.scene()),changed=new DesignDocument(prior);const button=prior.nodes.find(n=>n.properties.Name==='ActionButton');changed.setProperty('Width',234,[button.id]);applyDesignPatch(ds,designPatch(prior,changed.value));assert.equal(ds.vm.platform.scene().nodes.find(n=>n.id===button.runtimeId).properties.Width,234);}
    Object.assign(context, {DesignDocument, design});
  }},
  {id: 'designer:source-sync', order: 1960, async run(context) {
    const {plan, DesignDocument, design} = context;
    const {CSharpDesignSession,generateDesignCode}=await import('@sharpforge/designer');
    const linked=new CSharpDesignSession(generateDesignCode(design.value));
    const editDesign=new DesignDocument(linked.document);
    editDesign.setProperty('Width',279,['action']);
    const sourcePlan=linked.plan(editDesign.value);
    assert(sourcePlan.text.includes('279'));
    linked.commit(sourcePlan);
    assert.equal(linked.document.nodes.find(n=>n.id==='action').properties.Width,279);
  }},
];
