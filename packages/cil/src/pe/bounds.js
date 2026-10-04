import { CilError } from '../binary/error.js';

/** Validate a half-open range before arithmetic or seeking; an exclusive end may equal its limit. */
export function peRangeEnd(start, size, limit, message, diagnosticOffset = start) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(size) || size < 0 ||
      !Number.isSafeInteger(limit) || limit < 0 || start > limit || size > limit - start) {
    throw new CilError(message, typeof diagnosticOffset === 'number' ? diagnosticOffset : undefined);
  }
  return start + size;
}

/** SizeOfHeaders must contain the actual section table and refer only to existing file bytes. */
export function validatePEHeaderExtent(sizeOfHeaders, sectionTableEnd, fileSize, diagnosticOffset) {
  peRangeEnd(0, sizeOfHeaders, fileSize, 'Invalid PE SizeOfHeaders', diagnosticOffset);
  if (sizeOfHeaders < sectionTableEnd) throw new CilError('PE headers exceed SizeOfHeaders', diagnosticOffset);
}

function rejectOverlaps(intervals, message) {
  intervals.sort((left, right) => left.start - right.start || left.index - right.index);
  for (let index = 1; index < intervals.length; index++) {
    if (intervals[index].start < intervals[index - 1].end) {
      throw new CilError(message, intervals[index].diagnosticOffset);
    }
  }
}

/** Admit section ranges once in O(n log n) time/O(n) space, without reordering the public section array. */
export function validatePESections(sections, fileSize, sizeOfHeaders) {
  const raw = [];
  const virtual = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const rawEnd = peRangeEnd(section.offset, section.size, fileSize,
      'Truncated PE section', section.headerOffset + 20);
    const virtualSize = Math.max(section.size, section.virtualSize);
    const virtualEnd = peRangeEnd(section.rva, virtualSize, 0x100000000,
      'Invalid PE virtual section range', section.headerOffset + 12);
    // Keep the existing empty raw-pointer bound, but empty intervals cannot overlap anything.
    if (section.size) {
      if (section.offset < sizeOfHeaders) throw new CilError('PE section overlaps file headers', section.headerOffset + 20);
      raw.push({ start: section.offset, end: rawEnd, index, diagnosticOffset: section.headerOffset + 20 });
    }
    // Virtual-only/BSS sections still occupy address space; raw padding also remains addressable.
    if (virtualSize) {
      if (section.rva < sizeOfHeaders) throw new CilError('PE section overlaps virtual headers', section.headerOffset + 12);
      virtual.push({ start: section.rva, end: virtualEnd, index, diagnosticOffset: section.headerOffset + 12 });
    }
  }
  rejectOverlaps(raw, 'Overlapping PE raw sections');
  rejectOverlaps(virtual, 'Overlapping PE virtual sections');
}
