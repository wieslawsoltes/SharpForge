import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'winui:host-apis', order: 1480, async run(context) {
    const {WinUIHost,RenderSurface,createWinUIApp}=await import('@sharpforge/winui');
    assert.equal(typeof WinUIHost,'function');
    assert.equal(typeof RenderSurface,'function');
    assert.equal(typeof createWinUIApp,'function');
  }},
  {id: 'winui:code-first-scene', order: 1550, async run(context) {
    const {compileToIL, CilVirtualMachine} = context;
    const uc=compileToIL('using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;Window w=new Window(){Content=new Button(){Content="Hi"}};w.Activate();');
    assert(uc.success,JSON.stringify(uc.diagnostics));
    const uv=new CilVirtualMachine(uc.assembly);
    uv.run();
    assert.equal(uv.platform.scene().windows.length,1);
  }},
  {id: 'winui:animation', order: 2080, async run(context) {
    const {compileToIL, VirtualMachine, CilVirtualMachine} = context;
    const animation=compileToIL('using System;using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;using Microsoft.UI.Xaml.Media.Animation;var b=new Button();var a=new DoubleAnimation(){From=0,To=1,Duration=new Duration(TimeSpan.FromSeconds(1))};Storyboard.SetTarget(a,b);Storyboard.SetTargetProperty(a,"Opacity");var s=new Storyboard();s.Children.Add(a);s.Begin();SharpForge.UI.AnimationClock.AdvanceBy(500);Console.WriteLine(b.Opacity);');
    assert(animation.success,JSON.stringify(animation.diagnostics));
    for(const VM of [VirtualMachine,CilVirtualMachine])assert.equal(new VM(VM===VirtualMachine?animation.image:animation.assembly).run().output,'0.5\n');
  }},
];
