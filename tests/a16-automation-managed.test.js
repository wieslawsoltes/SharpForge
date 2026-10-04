import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { loadAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const prefix = `using System;using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Automation;using Microsoft.UI.Xaml.Automation.Peers;using Microsoft.UI.Xaml.Automation.Provider;
using Windows.Foundation;`;
const cases = [
  ['peer identity, explicit name and class', `
    Button button=new Button(){Content="Save"};
    AutomationProperties.SetName(button,"Save document");
    AutomationPeer first=FrameworkElementAutomationPeer.CreatePeerForElement(button);
    AutomationPeer second=FrameworkElementAutomationPeer.FromElement(button);
    Console.WriteLine(Object.ReferenceEquals(first,second));Console.WriteLine(first.GetName());Console.WriteLine(first.GetClassName());`,
  'True\nSave document\nButton\n'],
  ['text provider actions update the same managed TextBox', `
    TextBox box=new TextBox(){Text="old"};AutomationPeer peer=new TextBoxAutomationPeer(box);
    IValueProvider value=(IValueProvider)peer.GetPattern(PatternInterface.Value);
    value.SetValue("changed");Console.WriteLine(box.Text);
    ITextProvider text=(ITextProvider)peer.GetPattern(PatternInterface.Text);
    Console.WriteLine(text.DocumentRange.GetText(-1));`, 'changed\nchanged\n'],
  ['toggle and numeric providers update authoritative state', `
    CheckBox check=new CheckBox();AutomationPeer peer=new CheckBoxAutomationPeer(check);
    IToggleProvider toggle=(IToggleProvider)peer.GetPattern(PatternInterface.Toggle);toggle.Toggle();Console.WriteLine(check.IsChecked);
    Slider slider=new Slider(){Minimum=0,Maximum=10,Value=3};AutomationPeer rangePeer=new SliderAutomationPeer(slider);
    IRangeValueProvider range=(IRangeValueProvider)rangePeer.GetPattern(PatternInterface.RangeValue);
    range.SetValue(7);Console.WriteLine(slider.Value);`, 'True\n7\n'],
  ['password peers never expose text or value providers', `
    PasswordBox password=new PasswordBox(){Password="private"};AutomationPeer peer=new PasswordBoxAutomationPeer(password);
    Console.WriteLine(peer.IsPassword());Console.WriteLine(peer.GetPattern(PatternInterface.Value)==null);
    Console.WriteLine(peer.GetPattern(PatternInterface.Text)==null);`, 'True\nTrue\nTrue\n'],
  ['custom peer core overrides and protected base calls use the same receiver', `
    class NamedButton:Button { protected override AutomationPeer OnCreateAutomationPeer(){return new NamedPeer(this);} }
    class NamedPeer:ButtonAutomationPeer {
      public NamedPeer(Button owner):base(owner){}
      protected override string GetNameCore(){return "Custom " + base.GetNameCore();}
      protected override string GetClassNameCore(){return "NamedPeer";}
    }
    class P {static void Main(){NamedButton button=new NamedButton(){Content="Save"};
      AutomationPeer peer=FrameworkElementAutomationPeer.CreatePeerForElement(button);
      Console.WriteLine(peer.GetName());Console.WriteLine(peer.GetClassName());
      Console.WriteLine(Object.ReferenceEquals(peer,FrameworkElementAutomationPeer.FromElement(button)));}}`,
  'Custom Save\nNamedPeer\nTrue\n'],
  ['custom peer may explicitly suppress automation', `
    class QuietButton:Button {protected override AutomationPeer OnCreateAutomationPeer(){return null;}}
    class P {static void Main(){QuietButton button=new QuietButton();
      Console.WriteLine(FrameworkElementAutomationPeer.CreatePeerForElement(button)==null);}}`, 'True\n'],
  ['standalone custom peers initialize without an element owner', `
    class IndependentPeer:AutomationPeer {
      protected override string GetNameCore(){return "Independent";}
      protected override bool IsKeyboardFocusableCore(){return false;}
    }
    class P {static void Main(){AutomationPeer peer=new IndependentPeer();
      Console.WriteLine(peer.GetName());Console.WriteLine(peer.IsKeyboardFocusable());}}`, 'Independent\nFalse\n'],
  ['arranged peer bounds come from synchronous managed geometry', `
    Button button=new Button(){Width=40,Height=20};button.Measure(new Size(100,100));button.Arrange(new Rect(5,7,40,20));
    AutomationPeer peer=new ButtonAutomationPeer(button);Rect bounds=peer.GetBoundingRectangle();
    Console.WriteLine(bounds.X);Console.WriteLine(bounds.Y);Console.WriteLine(bounds.Width);`, '5\n7\n40\n']
];
const programs = new Map();
function compile(source) {
  if (!programs.has(source)) {
    const result = compileToIL(prefix + source);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    programs.set(source, result);
  }
  return programs.get(source);
}
for (const [engine, create] of Object.entries({ source: p => new VirtualMachine(p.image, { virtualTime: true }),
  reload: p => new VirtualMachine(loadAssembly(p.assembly), { virtualTime: true }),
  cil: p => new CilVirtualMachine(p.assembly, { virtualTime: true }) })) {
  for (const [name, source, expected] of cases) test(`${engine}: automation ${name}`, async () => {
    const vm = create(compile(source)), result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, expected);
    vm.stop();
  });
}
