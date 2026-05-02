// Parse a model response of the form "[1] text\n[2] text\n..." into a Map.
// Numbers > expectedCount are ignored. Missing numbers are absent from the map.
// Multi-line content under a single [N] header is concatenated with spaces.
export function parseNumberedResponse(text, expectedCount) {
  const result = new Map();
  if (!text || typeof text !== 'string') return result;

  const lines = text.split(/\r?\n/);
  let curNum = null;
  let curBuf = [];

  const commit = () => {
    if (curNum !== null && curNum >= 1 && curNum <= expectedCount) {
      const joined = curBuf.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) result.set(curNum, joined);
    }
    curNum = null;
    curBuf = [];
  };

  const headerRe = /^\s*\[(\d+)\]\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      commit();
      curNum = parseInt(m[1], 10);
      if (m[2]) curBuf.push(m[2]);
    } else if (curNum !== null) {
      const trimmed = line.trim();
      if (trimmed) curBuf.push(trimmed);
    }
  }
  commit();
  return result;
}
