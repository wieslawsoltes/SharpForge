"""Current per-document controls shared by the retained release acceptance suites."""
import json


class ReleaseDesignerControls:
    def __init__(self, page, snapshot, action, select, tool, evaluate, drag):
        self.page = page
        self.snapshot = snapshot
        self.action = action
        self.select = select
        self.tool = tool
        self.evaluate = evaluate
        self.drag = drag

    @property
    def host(self):
        uri = json.dumps(self.snapshot()['uri'])
        return self.page.locator(f'[data-designer-document={uri}]')

    def side(self, name):
        uri = json.dumps(self.snapshot()['uri'])
        return self.page.locator(f'[data-designer-uri={uri}][data-designer-panel="designer-{name}"]')

    def search_controls(self, value):
        panel = self.side('toolbox')
        panel.get_by_role('tab', name='All WinUI', exact=True).click()
        panel.get_by_role('searchbox', name='Search toolbox').fill(value)

    def overflow(self):
        button = self.host.locator('[data-design-action="more"]')
        if button.get_attribute('aria-expanded') != 'true':
            button.click()

    def editing_mode(self, value):
        self.overflow()
        self.host.locator('#designer-mode').select_option(value)
        self.page.keyboard.press('Escape')

    def new(self):
        previous = self.snapshot()['uri']
        self.overflow()
        self.host.locator('[data-design-action="new"]').click()
        self.page.locator('#explorer-choice').select_option('Window')
        self.page.locator('#ask-confirm').click()
        self.page.wait_for_function('uri=>sharpforge.designer.get().uri!==uri', arg=previous)
        self.host.locator('.design-preview [data-sf-id="action"]').wait_for()

    def tracks(self, axis, values):
        section = self.side('layout').locator('section').filter(has=self.page.get_by_role('heading', name=f'Grid {axis}', exact=True))
        while section.locator(f'input[aria-label^="{axis} "]').count() > len(values):
            section.get_by_role('button', name='−', exact=True).last.click()
        label = 'Add row' if axis == 'rows' else 'Add column'
        while section.locator(f'input[aria-label^="{axis} "]').count() < len(values):
            section.get_by_role('button', name=label, exact=True).click()
        for index, value in enumerate(values, 1):
            field = self.side('layout').get_by_role('textbox', name=f'{axis} {index} sizing', exact=True)
            field.fill(value)
            field.press('Tab')

    def grid(self):
        self.new()
        self.select('canvas')
        self.tool('designer-layout')
        self.side('layout').get_by_role('button', name='Convert to Grid', exact=True).click()
        assert self.node('canvas')['type'].endswith('.Grid')
        self.tracks('rows', ['100', '*', '80'])
        self.tracks('columns', ['200', '2*', '*'])
        assert len(self.node('canvas')['rows']) == 3
        self.select('action')
        self.evaluate('sharpforge.designer.set("HorizontalAlignment",0);sharpforge.designer.set("VerticalAlignment",0)')
        self.editing_mode('layout')
        element = self.host.locator('.design-preview [data-sf-id="action"]').bounding_box()
        parent = self.host.locator('.design-preview [data-sf-id="canvas"]').bounding_box()
        self.page.mouse.move(element['x'] + 20, element['y'] + 15)
        self.page.mouse.down()
        self.page.mouse.move(parent['x'] + parent['width'] * .8, parent['y'] + parent['height'] * .8, steps=8)
        self.page.mouse.up()
        assert self.node('action')['properties']['Row'] == 1, self.node('action')
        assert self.node('action')['properties']['Column'] >= 1
        self.editing_mode('pixel')

    def grid_boundary(self):
        self.editing_mode('layout')
        self.select('canvas')
        before = self.snapshot()['document']
        handles = self.host.locator('button[aria-label^="Resize columns "]')
        assert handles.count() == 2
        self.drag(handles.first, 24 * self.snapshot()['zoom'], 0)
        after = self.node('canvas')['columns']
        assert after[0] == {'valueType': 'Microsoft.UI.Xaml.GridLength', 'Value': 224, 'GridUnitType': 1}, after
        self.action('undo')
        assert self.snapshot()['document'] == before

    def node(self, identity):
        return next(node for node in self.snapshot()['document']['nodes'] if node['id'] == identity)

    def styles(self):
        self.new()
        self.select('action')
        self.tool('designer-styles')
        self.side('styles').get_by_role('combobox', name='Resource', exact=True).select_option('Accent')
        self.side('styles').get_by_role('combobox', name='New setter property', exact=True).select_option('FontSize')
        self.side('styles').get_by_role('textbox', name='New setter value', exact=True).fill('25')
        self.side('styles').get_by_role('button', name='Add setter', exact=True).click()
        assert self.snapshot()['document']['styles']['Accent']['setters']['FontSize'] == 25
        preview = self.host.locator('.design-preview [data-sf-id="action"]')
        assert preview.evaluate('e=>getComputedStyle(e).fontSize') == '25px'
        self.evaluate('sharpforge.designer.set("FontSize",32)')
        assert preview.evaluate('e=>getComputedStyle(e).fontSize') == '32px'
        self.evaluate('sharpforge.designer.clear("FontSize")')
        assert preview.evaluate('e=>getComputedStyle(e).fontSize') == '25px'

    def templates(self):
        self.select('action')
        self.tool('designer-styles')
        self.side('styles').get_by_role('button', name='Template…', exact=True).click()
        dialog = self.page.get_by_role('dialog', name='Create control template', exact=True)
        dialog.get_by_role('textbox', name='Key', exact=True).fill('Template1')
        dialog.get_by_role('button', name='Create template', exact=True).click()
        self.side('styles').get_by_role('button', name='Apply template and return', exact=True).click()
        self.side('styles').get_by_role('combobox', name='Resource', exact=True).select_option('Template1')
        self.side('styles').get_by_role('button', name='Apply to selection', exact=True).click()
        assert self.node('action')['template'] == 'Template1'
        assert self.host.locator('.design-preview [data-sf-id="action::presenter"]').count() == 1
        self.action('duplicate')
        other = self.snapshot()['selection'][0]
        assert self.host.locator(f'.design-preview [data-sf-id="{other}::presenter"]').count() == 1
        assert self.node(other)['template'] == 'Template1'
        self.side('styles').get_by_role('button', name='Edit template', exact=True).click()
        assert any(node['id'] == 'presenter' for node in self.snapshot()['document']['nodes'])
        self.side('styles').get_by_role('button', name='Cancel template edits', exact=True).click()

    def device(self):
        before = self.snapshot()['document']
        self.overflow()
        self.host.locator('[data-preview-option="device"]').select_option('390x844')
        self.page.keyboard.press('Escape')
        assert self.host.locator('.design-stage').evaluate('element=>element.style.width') == '390px'
        assert self.snapshot()['document'] == before
