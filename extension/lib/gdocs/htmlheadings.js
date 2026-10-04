// Headings from Google's own HTML copy of a Doc (export?format=html), which
// marks Heading 1–6 as <h1>…<h6> and the Title and Subtitle with classes:
// the same paragraphs a Docs table of contents lists. Used because the edit
// history's style commands do not always say which paragraphs are headings.
// Only the heading text is matched; nothing else from the copy is used.

// Named characters Google's HTML copy uses (HTML 4's set): Latin-1, Greek,
// dashes, quotes and common symbols. An unknown name is dropped.
const LATIN1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ');
const GREEK = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho  Sigma Tau Upsilon Phi Chi Psi Omega'.split(' ');
const OTHER = {
  amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  thetasym: 977, upsih: 978, piv: 982, sigmaf: 962, ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225,
  bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364,
  trade: 8482, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, lArr: 8656, uArr: 8657, rArr: 8658, dArr: 8659, hArr: 8660,
  forall: 8704, part: 8706, exist: 8707, nabla: 8711, isin: 8712, prod: 8719, sum: 8721, minus: 8722, lowast: 8727, radic: 8730,
  prop: 8733, infin: 8734, ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756, sim: 8764, cong: 8773,
  asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, sube: 8838, supe: 8839, perp: 8869, sdot: 8901,
  loz: 9674, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830,
};
const ENTITIES = new Map(Object.entries(OTHER));
LATIN1.forEach((n, k) => ENTITIES.set(n, 160 + k));
GREEK.forEach((n, k) => {
  if (!n) return;
  ENTITIES.set(n, 913 + k);
  ENTITIES.set(n.toLowerCase(), 945 + k);
});

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    const n = ENTITIES.get(e) ?? ENTITIES.get(e.toLowerCase());
    return n ? String.fromCodePoint(n) : '';
  });
}

export function normHeading(s) {
  return decode(String(s).replace(/<[^>]*>/g, '')).replace(/[\s ​]+/g, ' ').trim().toLowerCase();
}

// What two copies of a line are compared by: letters and digits only, so a
// dash, quote mark, emoji or space written differently never stops a match.
export function matchKey(s) {
  const n = normHeading(s);
  return n.replace(/[^\p{L}\p{N}]+/gu, '') || n;
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
    if (text) out.push({ level, text, key: matchKey(m[3]) });
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
  texts.forEach((t, k) => { if (normHeading(t || '')) mine.push({ k, n: matchKey(t || '') }); });
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
  const gain = (i, j) => (mine[i].n === blocks[j].key ? (blocks[j].level != null ? 3 : 2) : 0);
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
  blocks.forEach((b, j) => { if (b.level == null) return; const q = queue.get(b.key); if (q) q.push(j); else queue.set(b.key, [j]); });
  const pairs = [];
  mine.forEach((x, i) => { const q = queue.get(x.n); if (q && q.length) pairs.push([i, q.shift()]); });
  return pairs;
}
