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

// -> [{ level, text }] in document order. Title = 100, Subtitle = 101.
export function headingsFromHtml(html) {
  if (typeof html !== 'string' || !html) return [];
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const out = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<p\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/p>/gi;
  for (let m; (m = re.exec(body));) {
    let level = null, inner = '';
    if (m[1]) { level = Number(m[1]); inner = m[2]; } else {
      const cls = ` ${m[3]} `;
      if (/\stitle\s/.test(cls)) level = 100;
      else if (/\ssubtitle\s/.test(cls)) level = 101;
      inner = m[4];
    }
    if (level == null) continue;
    const text = normHeading(inner);
    if (text) out.push({ level, text });
  }
  return out;
}

// Marks the paragraphs whose text is a heading in the HTML copy, in order,
// on paragraphs that the history did not already style. texts: each
// paragraph's display text. -> number of paragraphs marked.
export function applyHtmlHeadings(paragraphs, texts, headings) {
  const queue = new Map();
  for (const hd of headings) {
    const q = queue.get(hd.text);
    if (q) q.push(hd.level); else queue.set(hd.text, [hd.level]);
  }
  let marked = 0;
  paragraphs.forEach((p, k) => {
    const q = queue.get(normHeading(texts[k] || ''));
    if (!q || !q.length) return;
    const level = q.shift();
    if (p.ps && Number(p.ps.h)) return;
    p.ps = { ...(p.ps || {}), h: level };
    marked++;
  });
  return marked;
}
