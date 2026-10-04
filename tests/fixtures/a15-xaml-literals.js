/** Reference literals use the Windows App SDK 1.8 Microsoft Learn type grammars.
 * See docs/a15-resources-templates.md for the pinned URLs and the three-component Thickness quirk.
 * Expected values are independent of the converter's implementation and use its documented portable data shape.
 */
const thickness = (left, top = left, right = left, bottom = top) => ({left, top, right, bottom});
const corners = (topLeft, topRight = topLeft, bottomRight = topLeft, bottomLeft = topLeft) =>
  ({topLeft, topRight, bottomRight, bottomLeft});
const grid = (value, unitType) => ({value, unitType});
const brush = color => ({kind: 'SolidColorBrush', color, opacity: 1});

export const literalCases = [
  ['double', '0', 0], ['double', '-0', -0], ['double', '+12.25', 12.25], ['double', '.5', 0.5],
  ['double', '-.5', -0.5], ['double', '5.', 5], ['double', '1e3', 1000], ['System.Double', '-2E-2', -0.02],
  ['double', ' Auto ', NaN], ['double', 'NaN', NaN], ['double', 'Infinity', Infinity], ['double', '-Infinity', -Infinity],
  ['float', '0.1', 0.10000000149011612], ['System.Single', '1.5', 1.5], ['float', 'NaN', NaN],
  ['bool', 'True', true], ['bool', 'False', false], ['System.Boolean', 'true', true], ['bool', ' FALSE ', false],
  ['int', '0', 0], ['int', '-2147483648', -2147483648], ['System.Int32', '2147483647', 2147483647],
  ['uint', '4294967295', 4294967295], ['System.UInt32', '+1', 1], ['byte', '255', 255], ['System.SByte', '-128', -128],
  ['short', '-32768', -32768], ['System.Int16', '32767', 32767], ['ushort', '65535', 65535],
  ['long', '-9223372036854775808', -9223372036854775808n], ['System.UInt64', '18446744073709551615', 18446744073709551615n],
  ['string', '  keep spacing  ', '  keep spacing  '], ['System.String', 'plain', 'plain'], ['object', '{escaped}', '{escaped}'],
  ['Thickness', '0', thickness(0)], ['Thickness', '5', thickness(5)], ['Thickness', '1,2', thickness(1, 2)],
  ['Thickness', '1 2', thickness(1, 2)], ['Thickness', '1,2,3,4', thickness(1, 2, 3, 4)],
  ['Thickness', ' 1 , 2 , 3 , 4 ', thickness(1, 2, 3, 4)], ['Thickness', '-2,.5', thickness(-2, 0.5)],
  ['Thickness', '1,2,99', thickness(1, 2)], ['Thickness', '1e1 2e1 3e1 4e1', thickness(10, 20, 30, 40)],
  ['CornerRadius', '0', corners(0)], ['CornerRadius', '4', corners(4)], ['CornerRadius', '1,2,3,4', corners(1, 2, 3, 4)],
  ['CornerRadius', '1 2 3 4', corners(1, 2, 3, 4)], ['CornerRadius', '.25', corners(0.25)],
  ['GridLength', 'Auto', grid(1, 'Auto')], ['GridLength', '*', grid(1, 'Star')], ['GridLength', '2*', grid(2, 'Star')],
  ['GridLength', '.5*', grid(0.5, 'Star')], ['GridLength', '0*', grid(0, 'Star')], ['GridLength', '42', grid(42, 'Pixel')],
  ['GridLength', '0', grid(0, 'Pixel')], ['GridLength', '1e2*', grid(100, 'Star')],
  ['Color', '#abc', '#ffaabbcc'], ['Color', '#8abc', '#88aabbcc'], ['Color', '#123456', '#ff123456'],
  ['Color', '#80123456', '#80123456'], ['Color', '#ABCDEF', '#ffabcdef'], ['Color', 'Transparent', '#00ffffff'],
  ['Color', 'Black', '#ff000000'], ['Color', 'White', '#ffffffff'], ['Color', 'Red', '#ffff0000'],
  ['Color', 'Green', '#ff008000'], ['Color', 'Blue', '#ff0000ff'], ['Color', 'Aqua', '#ff00ffff'],
  ['Color', 'Aquamarine', '#ff7fffd4'], ['Color', 'AntiqueWhite', '#fffaebd7'], ['Color', 'AliceBlue', '#fff0f8ff'],
  ['Color', 'CornflowerBlue', '#ff6495ed'], ['Color', 'DarkGoldenrod', '#ffb8860b'], ['Color', 'GhostWhite', '#fff8f8ff'],
  ['Color', 'LightGoldenrodYellow', '#fffafad2'], ['Color', 'MediumAquamarine', '#ff66cdaa'],
  ['Color', 'NavajoWhite', '#ffffdead'], ['Color', 'PapayaWhip', '#ffffefd5'], ['Color', 'RosyBrown', '#ffbc8f8f'],
  ['Color', 'SaddleBrown', '#ff8b4513'], ['Color', 'SeaShell', '#fffff5ee'], ['Color', 'SlateGray', '#ff708090'],
  ['Color', 'WhiteSmoke', '#fff5f5f5'], ['Color', 'YellowGreen', '#ff9acd32'], ['Color', ' tOmAtO ', '#ffff6347'],
  ['Brush', 'Red', brush('#ffff0000')], ['Brush', '#80332211', brush('#80332211')],
  ['SolidColorBrush', 'Transparent', brush('#00ffffff')], ['Brush', 'MediumPurple', brush('#ff9370db')],
  ['Point', '0,0', {x: 0, y: 0}], ['Point', '-1.5 2.5', {x: -1.5, y: 2.5}],
  ['Windows.Foundation.Point', '1e2,-2e2', {x: 100, y: -200}], ['Size', '4,5', {width: 4, height: 5}],
  ['Rect', '1,2,3,4', {x: 1, y: 2, width: 3, height: 4}], ['Vector2', '.5 -1', {x: 0.5, y: -1}],
  ['Duration', 'Automatic', {kind: 'Automatic'}], ['Duration', 'Forever', {kind: 'Forever'}],
  ['Duration', '0:0:5', {kind: 'TimeSpan', ticks: 50000000n}], ['Duration', '1', {kind: 'TimeSpan', ticks: 864000000000n}],
  ['Duration', '1.2:3:4.5', {kind: 'TimeSpan', ticks: 937845000000n}],
  ['Duration', '00:00:00.0000001', {kind: 'TimeSpan', ticks: 1n}],
  ['KeyTime', '0:0:0', {ticks: 0n}], ['KeyTime', '0:0:5.125', {ticks: 51250000n}], ['KeyTime', '2', {ticks: 1728000000000n}],
  ['TimeSpan', '-0:0:1', {ticks: -10000000n}], ['TimeSpan', '23:59:59.9999999', {ticks: 863999999999n}],
  ['TimeSpan', '10675199.02:48:05.4775807', {ticks: 9223372036854775807n}],
  ['TimeSpan', '-10675199.02:48:05.4775808', {ticks: -9223372036854775808n}],
  ['FontWeight', 'Thin', {weight: 100}], ['FontWeight', 'ExtraLight', {weight: 200}], ['FontWeight', 'Light', {weight: 300}],
  ['FontWeight', 'SemiLight', {weight: 350}], ['FontWeight', 'Normal', {weight: 400}], ['FontWeight', 'Medium', {weight: 500}],
  ['FontWeight', 'SemiBold', {weight: 600}], ['FontWeight', 'Bold', {weight: 700}], ['FontWeight', 'ExtraBold', {weight: 800}],
  ['FontWeight', 'Black', {weight: 900}], ['FontWeight', 'ExtraBlack', {weight: 950}], ['FontWeight', '450', {weight: 450}],
  ['Visibility', 'Visible', 0], ['Visibility', 'Collapsed', 1], ['Visibility', '1', 1],
  ['Alignment', 'Left', 0], ['Alignment', 'Stretch', 3], ['Options', 'One, Four', 5], ['Options', '-1', -1],
  ['Uri', 'ms-appx:///Assets/icon.png', {uri: 'ms-appx:///Assets/icon.png'}], ['FontFamily', 'Segoe UI', 'Segoe UI']
];

export const invalidLiterals = [
  ['double', '1,25', 'SFXAML020'], ['double', '1e10000', 'SFXAML020'], ['float', '3.5e38', 'SFXAML020'],
  ['double', 'undefined', 'SFXAML020'], ['double', '', 'SFXAML020'], ['bool', '1', 'SFXAML028'], ['bool', 'yes', 'SFXAML028'],
  ['int', '2147483648', 'SFXAML029'], ['int', '1.0', 'SFXAML029'], ['int', '1e1', 'SFXAML029'],
  ['uint', '-1', 'SFXAML029'], ['byte', '256', 'SFXAML029'], ['sbyte', '-129', 'SFXAML029'],
  ['long', '9223372036854775808', 'SFXAML029'], ['ulong', '-1', 'SFXAML029'],
  ['Thickness', '1,,2', 'SFXAML021'], ['Thickness', '1,2,', 'SFXAML021'], ['Thickness', '1,2,3,4,5', 'SFXAML021'],
  ['CornerRadius', '1,2', 'SFXAML021'], ['CornerRadius', '-1', 'SFXAML022'],
  ['GridLength', '-1', 'SFXAML023'], ['GridLength', '-2*', 'SFXAML023'], ['GridLength', 'auto', 'SFXAML020'],
  ['Color', '#12', 'SFXAML024'], ['Color', '#12345', 'SFXAML024'], ['Color', '#ggg', 'SFXAML024'],
  ['Color', 'constructor', 'SFXAML024'], ['Color', '__proto__', 'SFXAML024'], ['Color', 'RebeccaPurple', 'SFXAML024'],
  ['Point', '1', 'SFXAML021'], ['Duration', '-0:0:1', 'SFXAML025'], ['KeyTime', '-0:0:1', 'SFXAML025'],
  ['Duration', '24:00:00', 'SFXAML025'], ['Duration', '0:60:00', 'SFXAML025'], ['Duration', '0:0:60', 'SFXAML025'],
  ['Duration', '0:0:0.12345678', 'SFXAML025'], ['TimeSpan', '10675199.02:48:05.4775808', 'SFXAML025'],
  ['FontWeight', '0', 'SFXAML026'], ['FontWeight', '1000', 'SFXAML026'], ['FontWeight', '1.5', 'SFXAML026'],
  ['Visibility', 'Invisible', 'SFXAML033'], ['Visibility', 'Visible,Collapsed', 'SFXAML033'],
  ['Options', 'One, Unknown', 'SFXAML033'], ['constructor', 'x', 'SFXAML032']
];
