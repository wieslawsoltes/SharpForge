/** Build an ordered sliding plan; pinned blocks are immovable barriers within an arena. */
export function createCompactionPlan(arena, isPinned) {
  const blocks = [...arena.blocks.values()].sort((left, right) => left.offset - right.offset);
  const moves = [];
  let cursor = 0;
  let pinnedObjects = 0;
  let pinnedBytes = 0;
  for (const block of blocks) {
    if (isPinned(block)) {
      pinnedObjects++;
      pinnedBytes += block.allocatedBytes;
      cursor = block.offset + block.allocatedBytes;
      continue;
    }
    if (block.offset !== cursor) moves.push({blockId: block.id, from: block.offset, to: cursor, bytes: block.allocatedBytes});
    cursor += block.allocatedBytes;
  }
  return {arenaId: arena.id, moves, pinnedObjects, pinnedBytes, highWater: cursor};
}

/** Apply a plan synchronously while the mutator is suspended. Identity handles do not change. */
export function applyCompactionPlan(arena, plan, relocated = null) {
  if (plan.arenaId !== arena.id) throw new TypeError('Compaction plan belongs to another arena');
  let movedBytes = 0;
  for (const move of plan.moves) {
    const block = arena.blocks.get(move.blockId);
    if (!block || block.offset !== move.from || block.allocatedBytes !== move.bytes) {
      throw new Error('Compaction invariant: stale block plan');
    }
    arena.move(block, move.to);
    movedBytes += move.bytes;
    relocated?.(block);
  }
  arena.rebuild();
  arena.clearFreeSpace();
  return {movedObjects: plan.moves.length, movedBytes, pinnedObjects: plan.pinnedObjects, pinnedBytes: plan.pinnedBytes};
}
