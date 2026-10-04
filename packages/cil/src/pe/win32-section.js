import { align, CilError } from '../binary.js';
import { writeWin32Resources } from './win32-resources.js';

/** Place .rsrc immediately after .text; the generic section writer orders relocation data last. */
export function appendWin32ResourceSection(text, sections, options) {
  if (options.win32Resources === undefined) return sections;
  if (sections.some(section => section.name === '.rsrc')) throw new CilError('Duplicate Win32 resource section');
  const sectionRva = options.firstSectionRva + align(text.length, options.sectionAlignment);
  const library = ['library', 'netmodule'].includes(options.outputKind);
  return [...sections, { name: '.rsrc', data: writeWin32Resources(options.win32Resources, { sectionRva, library }) }];
}
