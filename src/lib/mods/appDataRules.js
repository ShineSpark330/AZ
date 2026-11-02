// What a mod with data:read may see INSIDE the kinds of records it was allowed.
// Kept separate from broker.js so it can be tested on its own.
//
//   • System chat: private channels (is_private) and everything said in them
//     are left out entirely, and so are messages that were deleted.
//   • Everything else is passed through as is (broker.js strips secret-looking
//     fields afterwards).

export function privateChannelIdSet(channels) {
  return new Set((channels || []).filter((c) => c && c.is_private).map((c) => c.id));
}

export function visibleRows(entity, rows, { privateChannelIds } = {}) {
  if (entity === "SystemChatChannel") return rows.filter((c) => !c.is_private);
  if (entity === "SystemChatMessage") {
    const hidden = privateChannelIds || new Set();
    return rows.filter((m) => !m.deleted_at && !hidden.has(m.channel_id));
  }
  return rows;
}

// For count-only access: how many records, and how many of them are still
// "live" (not archived or deleted).
export function countRows(rows) {
  const live = rows.filter((r) => !r.is_archived && !r.deleted_at);
  return { total: rows.length, active: live.length };
}
