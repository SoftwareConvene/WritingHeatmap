// Headings from Google's own HTML copy of a Doc (export?format=html), which
// marks Heading 1–6 as <h1>…<h6> and the Title and Subtitle with classes:
// the same paragraphs a Docs table of contents lists. Used because the edit
// history's style commands do not always say which paragraphs are headings.
// Only the heading text is matched; nothing else from the copy is used.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function normHeading(s) {
  return decode(String(s).replace(/<[^>]*>/g, '')).replace(/[\s ​]+/g, ' ').trim().toLowerCase();
}

// Every paragraph of the copy in document order, headings with their level
// (Title = 100, Subtitle = 101) and the rest with level null; empty ones are
// left out. -> [{ level, text }]
export function blocksFromHtml(html) {
  if (typeof html !== 'string' || !html) return [];
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const out = [];
  const re = /<(h[1-6]|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (let m; (m = re.exec(body));) {
    const tag = m[1].toLowerCase();
    let level = null;
    if (tag[0] === 'h') level = Number(tag[1]);
    else if (tag === 'p') {
      const cls = / class="([^"]*)"/i.exec(m[2]);
      const c = ` ${cls ? cls[1] : ''} `;
      if (/\stitle\s/.test(c)) level = 100;
      else if (/\ssubtitle\s/.test(c)) level = 101;
    }
    const text = normHeading(m[3]);
    if (text) out.push({ level, text });
  }
  return out;
}

// -> [{ level, text }]: the headings only.
export function headingsFromHtml(html) {
  return blocksFromHtml(html).filter((b) => b.level != null);
}

const MAX_CELLS = 30_000_000;

// Marks the paragraphs that are headings in the HTML copy, on paragraphs the
// history did not already style. The two copies are lined up paragraph by
// paragraph, so a line with the same words as a heading (an entry in the
// table of contents, a checklist, a rubric) is not taken for the heading
// itself. texts: each paragraph's display text; blocks: blocksFromHtml().
// -> number of paragraphs marked.
export function applyHtmlHeadings(paragraphs, texts, blocks) {
  const mine = [];
  texts.forEach((t, k) => { const n = normHeading(t || ''); if (n) mine.push({ k, n }); });
  const n = mine.length, m = blocks.length;
  if (!n || !blocks.some((b) => b.level != null)) return 0;
  const pairs = n * m > MAX_CELLS ? inOrder(mine, blocks) : aligned(mine, blocks);
  let marked = 0;
  for (const [i, j] of pairs) {
    const level = blocks[j].level;
    const p = paragraphs[mine[i].k];
    if (level == null || (p.ps && Number(p.ps.h))) continue;
    p.ps = { ...(p.ps || {}), h: level };
    marked++;
  }
  return marked;
}

// Longest common run of paragraphs; a heading lined up with a heading counts
// a little more, so a table of contents that only one copy holds lines up
// with nothing and the real heading is the one marked. -> [[i, j]]
function aligned(mine, blocks) {
  const n = mine.length, m = blocks.length, w = m + 1;
  const score = new Int32Array((n + 1) * w);
  const gain = (i, j) => (mine[i].n === blocks[j].text ? (blocks[j].level != null ? 3 : 2) : 0);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const g = gain(i, j);
      let best = Math.max(score[(i + 1) * w + j], score[i * w + j + 1]);
      if (g && g + score[(i + 1) * w + j + 1] > best) best = g + score[(i + 1) * w + j + 1];
      score[i * w + j] = best;
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    const g = gain(i, j);
    if (g && score[i * w + j] === g + score[(i + 1) * w + j + 1]) { pairs.push([i, j]); i++; j++; }
    else if (score[(i + 1) * w + j] >= score[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Very long Docs: each heading text matched to its paragraphs in order.
function inOrder(mine, blocks) {
  const queue = new Map();
  blocks.forEach((b, j) => { if (b.level == null) return; const q = queue.get(b.text); if (q) q.push(j); else queue.set(b.text, [j]); });
  const pairs = [];
  mine.forEach((x, i) => { const q = queue.get(x.n); if (q && q.length) pairs.push([i, q.shift()]); });
  return pairs;
}
