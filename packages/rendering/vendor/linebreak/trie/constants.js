// Shift size for getting the index-1 table offset.
export const SHIFT_1 = 6 + 5;

// Shift size for getting the index-2 table offset.
export const SHIFT_2 = 5;

// Difference between the two shift sizes,
// for getting an index-1 offset from an index-2 offset. 6=11-5
export const SHIFT_1_2 = SHIFT_1 - SHIFT_2;

// Number of index-1 entries for the BMP. 32=0x20
// This part of the index-1 table is omitted from the serialized form.
export const OMITTED_BMP_INDEX_1_LENGTH = 0x10000 >> SHIFT_1;

// Number of entries in an index-2 block. 64=0x40
export const INDEX_2_BLOCK_LENGTH = 1 << SHIFT_1_2;

// Mask for getting the lower bits for the in-index-2-block offset. */
export const INDEX_2_MASK = INDEX_2_BLOCK_LENGTH - 1;

// Shift size for shifting left the index array values.
// Increases possible data size with 16-bit index values at the cost
// of compactability.
// This requires data blocks to be aligned by DATA_GRANULARITY.
export const INDEX_SHIFT = 2;

// Number of entries in a data block. 32=0x20
export const DATA_BLOCK_LENGTH = 1 << SHIFT_2;

// Mask for getting the lower bits for the in-data-block offset.
export const DATA_MASK = DATA_BLOCK_LENGTH - 1;

// The part of the index-2 table for U+D800..U+DBFF stores values for lead
// surrogate code _units_ not code _points_. Values for lead surrogate code
// _points_ are indexed with this portion of the table.
// Length=32=0x20=0x400>>SHIFT_2. (There are 1024=0x400 lead surrogates.)
export const LSCP_INDEX_2_OFFSET = 0x10000 >> SHIFT_2;
export const LSCP_INDEX_2_LENGTH = 0x400 >> SHIFT_2;

// Count the lengths of both BMP pieces. 2080=0x820
export const INDEX_2_BMP_LENGTH = LSCP_INDEX_2_OFFSET + LSCP_INDEX_2_LENGTH;

// The 2-byte UTF-8 version of the index-2 table follows at offset 2080=0x820.
// Length 32=0x20 for lead bytes C0..DF, regardless of SHIFT_2.
export const UTF8_2B_INDEX_2_OFFSET = INDEX_2_BMP_LENGTH;
// U+0800 is the first code point after 2-byte UTF-8
export const UTF8_2B_INDEX_2_LENGTH = 0x800 >> 6;

// The index-1 table, only used for supplementary code points, at offset
// 2112=0x840. Variable length, for code points up to highStart, where the
// last single-value range starts. Maximum length 512=0x200=0x100000>>SHIFT_1.
// (For 0x100000 supplementary code points U+10000..U+10ffff.)
//
// The part of the index-2 table for supplementary code points starts after
// this index-1 table.
//
// Both the index-1 table and the following part of the index-2 table are
// omitted completely if there is only BMP data.
export const INDEX_1_OFFSET = UTF8_2B_INDEX_2_OFFSET + UTF8_2B_INDEX_2_LENGTH;
export const MAX_INDEX_1_LENGTH = 0x100000 >> SHIFT_1;

// The alignment size of a data block. Also the granularity for compaction.
export const DATA_GRANULARITY = 1 << INDEX_SHIFT;

// This goes in the third u32 of the input to show that we are decoding with
// the same format the input was encoded with.  Could theoretically decrement
// this for every major format change.
export const CURRENT_VERSION = 0xFFFFFFFF;

// Number of bytes before compressed data starts in this CURRENT_VERSION.
export const PREFIX_LENGTH = 16;

