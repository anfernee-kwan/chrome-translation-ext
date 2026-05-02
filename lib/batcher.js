// Build numbered batches. Numbering is local to each batch (1..N).
// Returns: Array<{ ids: string[], text: string }>
export function buildBatches(items, { maxChars, maxItems }) {
  const batches = [];
  let cur = { ids: [], lines: [], chars: 0 };

  const flush = () => {
    if (cur.ids.length === 0) return;
    batches.push({ ids: cur.ids, text: cur.lines.join('\n') });
    cur = { ids: [], lines: [], chars: 0 };
  };

  for (const item of items) {
    const cleaned = item.text.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const projected = cur.chars + cleaned.length;
    const overChars = cur.ids.length > 0 && projected > maxChars;
    const overItems = cur.ids.length >= maxItems;
    if (overChars || overItems) flush();
    const localN = cur.ids.length + 1;
    cur.ids.push(item.id);
    cur.lines.push(`[${localN}] ${cleaned}`);
    cur.chars += cleaned.length;
  }
  flush();
  return batches;
}
