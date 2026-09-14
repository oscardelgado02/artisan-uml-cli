// Pragmatic C# parser → diagram nodes.
// ponytail: regex/brace-tracking parser, not a full syntax tree. Covers typical
// Unity/C# code: namespaces, class/struct/interface/enum/record (+ nesting),
// fields, properties, methods, visibility, common modifiers. Exotic constructs
// (positional records, events, delegates) land approximately or are skipped.
// Upgrade path: swap parseCs internals for a real C# AST, keep output shape.
import { hid } from './store.mjs';

// Strip comments and string bodies so they cannot confuse the parser.
function stripNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | str | verbatim | char
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') {
        mode = 'line';
        i += 2;
      } else if (c === '/' && c2 === '*') {
        mode = 'block';
        i += 2;
      } else if (c === '@' && c2 === '"') {
        mode = 'verbatim';
        out += ' ';
        i += 2;
      } else if (c === '$' && c2 === '"') {
        mode = 'str';
        out += ' ';
        i += 2;
      } else if (c === '"') {
        mode = 'str';
        out += ' ';
        i++;
      } else if (c === "'") {
        mode = 'char';
        out += ' ';
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += '\n';
      }
      i++;
    } else if (mode === 'block') {
      if (c === '*' && c2 === '/') {
        mode = 'code';
        i += 2;
      } else {
        if (c === '\n') out += '\n';
        i++;
      }
    } else if (mode === 'str') {
      if (c === '\\') i += 2;
      else if (c === '"') {
        mode = 'code';
        i++;
      } else i++;
    } else if (mode === 'verbatim') {
      if (c === '"' && c2 === '"') i += 2;
      else if (c === '"') {
        mode = 'code';
        i++;
      } else i++;
    } else {
      if (c === '\\') i += 2;
      else if (c === "'") {
        mode = 'code';
        i++;
      } else i++;
    }
  }
  return out;
}

const VIS_MAP = { public: '+', private: '-', protected: '#', internal: '~' };

function splitTop(s, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.filter((p) => p.trim().length);
}

// "int dx, string name = x" → "dx: int, name: string"
function umlParams(raw) {
  const t = raw.trim();
  if (!t) return '';
  const out = [];
  for (const p of splitTop(t)) {
    let s = p
      .trim()
      .replace(/\b(ref|out|in|params|this)\b/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s*=\s*[\s\S]*$/, '')
      .trim();
    if (!s) continue;
    const m = s.match(/^([A-Za-z_][\w<>\[\],. ?]*?)\s+([A-Za-z_]\w*)$/);
    out.push(m ? `${m[2]}: ${m[1].trim()}` : s.replace(/\s+/g, ' '));
  }
  return out.join(', ');
}

function matchingBrace(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return s.length - 1;
}

const TYPE_RE =
  /(\bpublic\b|\binternal\b|\bprotected\b|\bprivate\b)?\s*((?:\bstatic\b|\babstract\b|\bsealed\b|\bpartial\b)\s*)*\b(class|struct|interface|enum|record)\s+([A-Za-z_]\w*)[^{;]*(\{|;)/g;

// Find type declarations and their brace ranges; compute nesting (full names).
function parseTypes(clean, file) {
  const nsDecl = clean.match(/namespace\s+([\w.]+)\s*(\{|;)/);
  const namespace = nsDecl ? nsDecl[1] : '';
  const found = [];
  TYPE_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_RE.exec(clean))) {
    const kw = m[3];
    const name = m[4];
    const openIdx = m.index + m[0].lastIndexOf('{');
    const baseRaw = /:\s*([^{;]+)/.exec(m[0])?.[1] || '';
    const closeIdx = m[5] === '{' ? matchingBrace(clean, openIdx) : openIdx;
    const kind =
      kw === 'record'
        ? 'record'
        : kw === 'struct'
          ? 'struct'
          : kw === 'enum'
            ? 'enum'
            : kw === 'interface'
              ? 'interface'
              : /\babstract\b/.test(m[2] || '')
                ? 'abstract'
                : 'class';
    const bases = baseRaw
      ? splitTop(baseRaw)
          .map((b) => b.trim().split(/\s+/).pop().split('.').pop())
          .filter((b) => /^[A-Za-z_]\w*$/.test(b))
      : [];
    found.push({
      name,
      kind,
      vis: m[1] ? VIS_MAP[m[1]] : '~',
      bases,
      open: openIdx,
      close: closeIdx,
      line: clean.slice(0, m.index).split('\n').length,
      file,
      namespace,
      parent: null,
    });
    if (m[5] === '{') TYPE_RE.lastIndex = openIdx + 1; // scan inside for nested types
  }
  // Build nesting: parent = smallest enclosing type range.
  for (const t of found) {
    for (const u of found) {
      if (u !== t && u.open < t.open && t.close < u.close) {
        if (!t.parent || (u.open > t.parent.open && u.close < t.parent.close)) t.parent = u;
      }
    }
  }
  const fullOf = (t) => {
    const chain = [];
    let p = t;
    while (p) {
      chain.unshift(p.name);
      p = p.parent;
    }
    return (namespace ? namespace + '.' : '') + chain.join('.');
  };
  for (const t of found) {
    t.full = fullOf(t);
    // body = my range minus descendant ranges
    const kids = found.filter((u) => u.parent === t);
    const body = { ranges: [] };
    let cur = t.open + 1;
    const ends = kids.map((k) => [k.open, k.close]).sort((a, b) => a[0] - b[0]);
    for (const [ko, kc] of ends) {
      if (ko > cur) body.ranges.push([cur, ko]);
      cur = Math.max(cur, kc + 1);
    }
    if (cur < t.close) body.ranges.push([cur, t.close]);
    t.bodyRanges = body.ranges;
  }
  return found;
}

const SKIP_NAMES = new Set(['operator', 'implicit', 'explicit']);

const MEMBER_RE =
  /(\bpublic\b|\bprivate\b|\bprotected\b|\binternal\b)?\s*((?:\bstatic\b|\babstract\b|\bsealed\b|\bvirtual\b|\boverride\b|\basync\b|\breadonly\b|\bconst\b|\bnew\b|\bextern\b|\bunsafe\b|\bpartial\b|\bevent\b)*)\s*([\w<>\[\],.?]+)\s+([A-Za-z_]\w*)\s*(\(|\{|;|=)/g;

function* bodyText(clean, ranges) {
  for (const [a, b] of ranges) yield clean.slice(a, b);
}

function parseMembers(clean, t) {
  const attributes = [];
  const methods = [];
  if (t.kind === 'enum') {
    const body = [...bodyText(clean, t.bodyRanges)].join('\n');
    const re = /([A-Za-z_]\w*)\s*(?:=[^,\n]+)?[,]?/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(body))) {
      const name = m[1];
      if (['get', 'set', 'value'].includes(name) || seen.has(name)) continue;
      seen.add(name);
      attributes.push({ vis: '-', name, type: '', mods: [], params: null });
    }
    return { attributes, methods };
  }
  const isInterface = t.kind === 'interface';
  for (const text of bodyText(clean, t.bodyRanges)) {
    const re = MEMBER_RE;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const type = m[3].trim();
      const name = m[4];
      const tail = m[5];
      if (SKIP_NAMES.has(name)) continue;
      if (/\b(record|class|struct|enum|interface|namespace|using|return|new|delegate)\b/.test(type)) continue;
      const vis = m[1] ? VIS_MAP[m[1].trim().split(/\s+/).pop()] : isInterface ? '+' : '-';
      const mods = (m[2] || '').match(/\b(static|abstract|readonly|virtual|override|sealed|async|const)\b/g) || [];
      if (tail === '(') {
        // method or constructor — capture params, then skip its body/semicolon
        const open = text.indexOf('(', m.index + m[0].length - 1);
        let depth = 0;
        let close = open;
        for (let k = open; k < text.length; k++) {
          if (text[k] === '(') depth++;
          else if (text[k] === ')') {
            depth--;
            if (depth === 0) {
              close = k;
              break;
            }
          }
        }
        const ret = name === t.name ? '' : type; // constructor → no return type
        methods.push({ vis, name, type: ret, mods: [...mods], params: umlParams(text.slice(open + 1, close)) });
        re.lastIndex = afterMemberBody(text, close + 1);
      } else if (tail === '{') {
        attributes.push({ vis, name, type, mods: [...mods], params: null });
        re.lastIndex = matchingBrace(text, m.index + m[0].length - 1) + 1; // skip get/set block
      } else if (tail === '=') {
        const semi = skipToSemicolon(text, m.index + m[0].length); // field init / expression-bodied
        const init = text.slice(m.index + m[0].length, semi - 1);
        const attr = { vis, name, type, mods: [...mods], params: null };
        if (/\bnew\s+[\w<>\[\],.\s]+\(/.test(init)) attr.init = 'new';
        attributes.push(attr);
        re.lastIndex = semi;
      } else {
        // ';' — plain field
        attributes.push({ vis, name, type, mods: [...mods], params: null });
      }
    }
  }
  return { attributes, methods };
}

function afterMemberBody(text, from) {
  // Skip past `=> expr;` / `where...` / `{ body }` / `;` following a signature.
  let i = from;
  while (i < text.length && /[\s\w<>]/.test(text[i])) i++; // tolerate whitespace/where clauses crudely
  if (text[i] === '{') return matchingBrace(text, i) + 1;
  if (text[i] === ';') return i + 1;
  if (text[i] === '=' && text[i + 1] === '>') {
    return skipToSemicolon(text, i + 2);
  }
  return i;
}

function skipToSemicolon(text, from) {
  let i = from;
  while (i < text.length) {
    if (text[i] === ';') return i + 1;
    if (text[i] === '{') i = matchingBrace(text, i) + 1;
    else i++;
  }
  return i;
}

export function parseCsFile(src, file) {
  const clean = stripNoise(src);
  const types = parseTypes(clean, file);
  const nodes = [];
  for (const t of types) {
    const { attributes, methods } = parseMembers(clean, t);
    const node = {
      id: hid(t.full),
      kind: t.kind,
      name: t.name,
      attributes: attributes.map((m) => ({ ...m, id: hid(t.full + '|a|' + m.name + '|' + m.type) })),
      methods: methods.map((m) => ({ ...m, id: hid(t.full + '|m|' + m.name + '|' + m.params) })),
    };
    // deterministic dedupe (overloads)
    const seen = new Set();
    for (const list of [node.attributes, node.methods]) {
      for (const m of list) {
        if (seen.has(m.id)) {
          let k = 2;
          while (seen.has(m.id + k)) k++;
          m.id = m.id + k;
        }
        seen.add(m.id);
      }
    }
    nodes.push({ node, meta: { file, namespace: t.namespace, line: t.line, bases: t.bases, full: t.full, vis: t.vis } });
  }
  return nodes;
}
