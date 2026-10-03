import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'extensions:build-info', order: 250, async run(context) {
    const {VirtualMachine, Workspace, ExtensionDriver, BuildInfoGenerator} = context;
    const ws=new Workspace({extensions:new ExtensionDriver().registerGenerator(BuildInfoGenerator),extensionOptions:{version:'isolated'}});
    ws.update('Program.cs','Console.WriteLine(GeneratedBuildInfo.Version());',1);
    const generated=ws.compile();
    assert(generated.success);
    assert.equal(new VirtualMachine(generated.image).run().output,'isolated\n');
  }},
  {id: 'extensions:immutable-schema', order: 970, async run(context) {
    const {compileToIL, source, CilVirtualMachine, Workspace, ExtensionDriver} = context;
    const {JsonSchemaGenerator,UnreachableStatementAnalyzer}=await import('@sharpforge/extensions');
    const immutable=new Workspace({extensions:new ExtensionDriver().registerGenerator(JsonSchemaGenerator).registerAnalyzer(UnreachableStatementAnalyzer),additionalFiles:[{uri:'row.schema.json',text:JSON.stringify({name:'Row',immutable:true,fields:[{name:'Value',type:'int'}]})}]});
    immutable.update('Program.cs','var row=new Row(42);Console.WriteLine(row.Value);',1);
    const model=immutable.compile();
    assert(model.success,JSON.stringify(model.diagnostics));
    assert.equal(new CilVirtualMachine(compileToIL([...immutable.documents.values()].map(d=>d.source).concat(model.generatedSources.map(d=>({uri:d.uri,text:d.text})))).assembly).run().output,'42\n');
  }},
];
