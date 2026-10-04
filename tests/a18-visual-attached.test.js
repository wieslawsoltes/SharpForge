import test from 'node:test';
import assert from 'node:assert/strict';
import {areaReservations, CONTROLS, findContracts} from '@sharpforge/framework';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {createDesign, DesignDocument, generateDesignCode, setResponsiveState} from '@sharpforge/designer';

const attached = [
  ['Canvas', 'Left', 12.5, 0], ['Canvas', 'Top', -3.5, 0], ['Canvas', 'ZIndex', -4, 0],
  ['Grid', 'Row', 2, 0], ['Grid', 'Column', 3, 0], ['Grid', 'RowSpan', 4, 1], ['Grid', 'ColumnSpan', 5, 1],
  ['VariableSizedWrapGrid', 'RowSpan', 6, 1], ['VariableSizedWrapGrid', 'ColumnSpan', 7, 1]
];

function execute(source, expected, inspect = () => {}) {
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const Machine of [VirtualMachine, CilVirtualMachine]) {
    const machine = new Machine(Machine === VirtualMachine ? compiled.image : compiled.assembly);
    const result = machine.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output.replace(/\r/g, ''), expected, Machine.name);
    inspect(machine);
  }
}

test('attached dependency property identifiers occupy only the reserved A18 contract block', () => {
  const reservation = areaReservations.find(area => area.name === 'A18');
  const ids = attached.map(([owner, member]) => {
    const contracts = findContracts(CONTROLS + owner, `get_${member}Property`, true);
    assert.equal(contracts.length, 1);
    assert.equal(contracts[0].owner, CONTROLS + owner);
    assert.equal(contracts[0].result, 'Microsoft.UI.Xaml.DependencyProperty');
    assert(contracts[0].id >= reservation.start && contracts[0].id < reservation.start + reservation.size);
    return contracts[0].id;
  });
  assert.equal(new Set(ids).size, 9);
});

test('all attached getters and dependency property operations share values and exact local state', () => {
  const statements = attached.flatMap(([owner, member, value]) => [
    `Console.WriteLine(button.ReadLocalValue(${owner}.${member}Property) == DependencyProperty.UnsetValue);`,
    `${owner}.Set${member}(button, ${value});`,
    `Console.WriteLine(button.GetValue(${owner}.${member}Property));`,
    `button.SetValue(${owner}.${member}Property, ${value});`,
    `Console.WriteLine(${owner}.Get${member}(button));`,
    `button.ClearValue(${owner}.${member}Property);`,
    `Console.WriteLine(${owner}.Get${member}(button));`,
    `Console.WriteLine(button.ReadLocalValue(${owner}.${member}Property) == DependencyProperty.UnsetValue);`
  ]);
  const expected = attached.flatMap(([, , value, defaultValue]) => ['True', value, value, defaultValue, 'True']).join('\n') + '\n';
  execute(`using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
    class Program { static void Main() { var button = new Button(); ${statements.join('\n')} } }`, expected);
});

test('Grid and wrap dependency properties with identical member names remain independent', () => {
  execute(`using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
    class Program { static void Main() {
      var button = new Button();
      Grid.SetColumnSpan(button, 3);
      VariableSizedWrapGrid.SetColumnSpan(button, 5);
      button.ClearValue(Grid.ColumnSpanProperty);
      Console.WriteLine(Grid.GetColumnSpan(button));
      Console.WriteLine(VariableSizedWrapGrid.GetColumnSpan(button));
      Console.WriteLine(button.ReadLocalValue(VariableSizedWrapGrid.ColumnSpanProperty));
      button.ClearValue(VariableSizedWrapGrid.ColumnSpanProperty);
      Console.WriteLine(VariableSizedWrapGrid.GetColumnSpan(button));
      Console.WriteLine(button.ReadLocalValue(VariableSizedWrapGrid.ColumnSpanProperty) == DependencyProperty.UnsetValue);
    } }`, '1\n5\n5\n1\nTrue\n');
});

test('dependency properties reject wrong owners, nonvisual targets and invalid spans before mutation', () => {
  const cases = [
    ['button.SetValue(RowDefinition.HeightProperty, new GridLength(25));', 'InvalidOperationException'],
    ['new RowDefinition().ClearValue(Canvas.LeftProperty);', 'InvalidOperationException'],
    ['button.SetValue(Grid.ColumnSpanProperty, 0);', 'ArgumentOutOfRangeException'],
    ['button.SetValue(Grid.RowProperty, 2.5);', 'ArgumentOutOfRangeException']
  ];
  for (const [statement, fault] of cases) {
    const compiled = compileToIL(`using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
      class Program { static void Main() {
        var button = new Button() { Name = "Target" };
        Grid.SetColumnSpan(button, 3);
        var window = new Window() { Content = button };
        window.Activate();
        ${statement}
      } }`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    for (const Machine of [VirtualMachine, CilVirtualMachine]) {
      const machine = new Machine(Machine === VirtualMachine ? compiled.image : compiled.assembly);
      const result = machine.run();
      assert.equal(result.state, 'faulted', statement);
      assert.equal(result.fault.name, fault, statement);
      const node = machine.platform.scene().nodes.find(node => node.properties.Name === 'Target');
      assert.equal(node.properties.ColumnSpan, 3);
      assert(!node.localProperties.includes('Row'));
    }
  }
});

test('previously unset adaptive Canvas, Grid and wrap overrides clear on both managed engines', () => {
  const design = createDesign();
  const action = design.nodes.find(node => node.id === 'action');
  for (const [, member] of attached) delete action.properties[member];
  const document = new DesignDocument(design);
  const overrides = Object.fromEntries(attached.map(([owner, member, value]) =>
    [owner === 'VariableSizedWrapGrid' ? `Wrap${member}` : member, value]));
  setResponsiveState(document, {id: 'Compact', minWidth: 0, maxWidth: 600, overrides: {action: overrides}});
  const print = attached.map(([owner, member]) =>
    `Console.WriteLine(Microsoft.UI.Xaml.Controls.${owner}.Get${member}(DesignedView.v_action));`).join('\n');
  const unset = attached.map(([owner, member]) =>
    `Console.WriteLine(DesignedView.v_action.ReadLocalValue(Microsoft.UI.Xaml.Controls.${owner}.${member}Property)`
      + ' == Microsoft.UI.Xaml.DependencyProperty.UnsetValue);').join('\n');
  const source = generateDesignCode(document.value) + `
    class Program {
      public static void OnAction(object sender, Microsoft.UI.Xaml.RoutedEventArgs args) {}
      static void Main() {
        DesignedView.Create();
        DesignedView.ApplyAdaptive(300.0); ${print}
        DesignedView.ApplyAdaptive(900.0); ${print} ${unset}
        DesignedView.ApplyAdaptive(599.0); ${print}
        DesignedView.ApplyAdaptive(600.0); ${print} ${unset}
      }
    }`;
  const values = attached.map(([, , value]) => value);
  const defaults = attached.map(([, , , value]) => value);
  const cycle = [...values, ...defaults, ...attached.map(() => 'True')];
  execute(source, [...cycle, ...cycle].join('\n') + '\n', machine => {
    const node = machine.platform.scene().nodes.find(node => node.properties.Name === action.properties.Name);
    assert(node);
    for (const property of Object.keys(overrides)) assert(!node.localProperties.includes(property));
  });
});
