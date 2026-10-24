// diagrams/code/tokenize.mjs — a tiny dependency-free tokenizer.
//
// Enough for a 6-12 line snippet on screen: comments, strings, numbers,
// keywords, function names and punctuation. No parser, no language server.
const KEYWORDS = {
  js: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'await', 'async', 'import', 'from', 'export', 'default', 'new', 'class', 'extends', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false']),
  ts: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'await', 'async', 'import', 'from', 'export', 'default', 'new', 'class', 'extends', 'interface', 'type', 'implements', 'public', 'private', 'readonly', 'enum', 'as', 'this', 'null', 'undefined', 'true', 'false']),
  bash: new Set(['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'case', 'esac', 'function', 'export', 'return', 'echo', 'cd', 'npm', 'node', 'git', 'run']),
  json: new Set(['true', 'false', 'null']),
  css: new Set(['important', 'media', 'import', 'root']),
};

const COMMENT = {
  js: /\/\/.*$|\/\*.*?\*\//,
  ts: /\/\/.*$|\/\*.*?\*\//,
  json: /\/\/.*$/,
  bash: /(^|\s)#.*$/,
  html: /<!--.*?-->/,
  css: /\/\*.*?\*\//,
};

export function tokenizeLine(line, language = 'js') {
  const lang = KEYWORDS[language] ? language : 'js';
  const kw = KEYWORDS[lang];
  const out = [];
  let i = 0;
  const s = String(line ?? '');
  while (i < s.length) {
    const rest = s.slice(i);
    const cm = rest.match(COMMENT[lang] ?? COMMENT.js);
    if (cm && cm.index === 0) { out.push({ t: rest, cls: 'c' }); break; }
    const ch = rest[0];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = 1;
      while (j < rest.length && rest[j] !== ch) { if (rest[j] === '\\') j++; j++; }
      out.push({ t: rest.slice(0, j + 1), cls: 's' });
      i += j + 1;
      continue;
    }
    const num = rest.match(/^\d+(?:\.\d+)?/);
    if (num) { out.push({ t: num[0], cls: 'n' }); i += num[0].length; continue; }
    const word = rest.match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const w = word[0];
      const next = rest.slice(w.length).match(/^\s*\(/);
      const cls = kw.has(w) ? 'k' : next ? 'f' : /^[A-Z]/.test(w) ? 't' : 'p';
      out.push({ t: w, cls });
      i += w.length;
      continue;
    }
    out.push({ t: ch, cls: 'p' });
    i += 1;
  }
  return out;
}

export function tokenizeLines(lines, language = 'js') {
  return (lines ?? []).map((line) => ({ tokens: tokenizeLine(line, language) }));
}
