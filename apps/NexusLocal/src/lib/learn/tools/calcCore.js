// @ts-nocheck
/* Portet 1:1 fra Concept Module-artefaktets math scratchpad (v48).
   Håndskrevet parser — bevidst INGEN eval/new Function: parseren ER
   sikkerheden, og den regel følger med i porten. Ændringer i sproget skal
   ske BEGGE steder (artefaktet er kilden).*/
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* ═══ math scratchpad ═══════════════════════════════════════════════════════
   A hand-written parser and evaluator — deliberately NOT eval/new Function.
   This page holds a Claude session and its content is a document; nothing
   in it may execute arbitrary code. Values are numbers or vectors; each
   line is an expression or `name = expr`, evaluated top to bottom. */
const CALC_FNS = new Map(Object.entries({
  abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log,
  log2: Math.log2, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  round: Math.round, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
}));
const CALC_CONST = new Map([["pi", Math.PI], ["e", Math.E]]);
// Names a definition may not take: shadowing `sum` would silently change
// what every later line means.
const CALC_RESERVED = new Set([
  ...CALC_FNS.keys(), ...CALC_CONST.keys(),
  "sum", "mean", "sd", "min", "max", "len", "norm", "dot", "dist",
  "transpose", "det", "inv", "solve", "identity",
]);

/* LaTeX in, calculator language out. The lesson's formulas are written in
   LaTeX, so the scratchpad accepts them: \frac, \sqrt, \cdot, ^{...},
   subscripts, greek, and the decoration commands are normalised BEFORE the
   tokenizer \u2014 a pure text rewrite, never evaluation. Subscript braces are
   the one thing kept: `x_{t-1}` must reach the tokenizer whole, because it
   is an identifier, not arithmetic. */
function latexPre(src){
  let s = String(src);
  if(/\\(sum|prod|int)(?![a-zA-Z])/.test(s)) throw "\\sum/\\prod/\\int: write the terms out \u2014 sum([\u2026]) adds a vector";
  s = s.replace(/\$/g, " ");
  // Matrix-miljøer → [[r1c1, r1c2], [r2c1, …]]. Rows split on \\\\, cells on &.
  for(let g = 0; g < 20; g++){
    const m = s.match(/\\begin\{([pbv]?)matrix\}([\s\S]*?)\\end\{\1matrix\}/);
    if(!m) break;
    const rows = m[2].trim().split(/\\\\/).map(r => r.trim()).filter(Boolean)
      .map(r => "[" + r.split("&").map(c => c.trim()).join(", ") + "]");
    s = s.slice(0, m.index) + " [" + rows.join(", ") + "] " + s.slice(m.index + m[0].length);
  }
  for(let g = 0; g < 50; g++){
    const b = s;
    s = s.replace(/\\(?:operatorname|text|mathrm|mathit|mathbf|boldsymbol|mathcal|vec|hat|tilde)\s*\{([^{}]*)\}/g, "$1");
    s = s.replace(/\\(?:bar|overline)\s*\{([^{}]*)\}/g, "$1_bar");
    if(s === b) break;
  }
  for(let g = 0; g < 50; g++){                       // innermost \frac first
    const m = s.match(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/);
    if(!m) break;
    s = s.slice(0, m.index) + `((${m[1]})/(${m[2]}))` + s.slice(m.index + m[0].length);
  }
  if(/\\[dt]?frac/.test(s)) throw "could not unfold \\frac \u2014 check the braces";
  for(let g = 0; g < 50; g++){
    const mn = s.match(/\\sqrt\s*\[([^\][]*)\]\s*\{([^{}]*)\}/);
    if(mn){ s = s.slice(0, mn.index) + `((${mn[2]})^(1/(${mn[1]})))` + s.slice(mn.index + mn[0].length); continue; }
    const m2 = s.match(/\\sqrt\s*\{([^{}]*)\}/);
    if(m2){ s = s.slice(0, m2.index) + `sqrt(${m2[1]})` + s.slice(m2.index + m2[0].length); continue; }
    break;
  }
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\(cdot|times|ast)\b/g, "*").replace(/\\div\b/g, "/");
  s = s.replace(/\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|pi|exp|ln|log|sin|cos|tan|min|max)\b/g, "$1");
  s = s.replace(/\\[,;:!]/g, " ");
  const bad = s.match(/\\[a-zA-Z]+/);
  if(bad) throw `unsupported LaTeX: ${bad[0]}`;
  s = s.replace(/\\/g, " ");
  // Remaining braces become parens \u2014 except a brace group right after `_`,
  // which is a subscript and belongs to the identifier.
  let out = "";
  const stack = [];
  for(const c of s){
    if(c === "{"){
      const sub = out.replace(/\s+$/, "").endsWith("_");
      stack.push(sub); out += sub ? "{" : "(";
    } else if(c === "}"){
      out += stack.pop() ? "}" : ")";
    } else out += c;
  }
  return out;
}

const CALC_ID_START = /[a-zA-Z\u00c0-\u024f\u0370-\u03ff_]/;
const CALC_ID_CHAR = /[a-zA-Z0-9\u00c0-\u024f\u0370-\u03ff_]/;

function calcTokens(s){
  const out = []; let i = 0;
  while(i < s.length){
    const c = s[i];
    if(/\s/.test(c)){ i++; continue; }
    if(/[0-9.]/.test(c)){
      let j = i; while(j < s.length && /[0-9._]/.test(s[j])) j++;
      if(s[j] === "e" && /[0-9+-]/.test(s[j+1] || "")){ j++; if(/[+-]/.test(s[j])) j++; while(j < s.length && /[0-9]/.test(s[j])) j++; }
      const v = Number(s.slice(i, j).replace(/_/g, ""));
      if(!Number.isFinite(v)) throw `bad number: ${s.slice(i, j)}`;
      out.push({ t: "num", v }); i = j; continue;
    }
    if(CALC_ID_START.test(c)){
      let j = i;
      while(j < s.length){
        if(CALC_ID_CHAR.test(s[j])){ j++; continue; }
        // `x_{t-1}` is ONE name: a braced subscript rides along, whitespace
        // inside it dropped so `x_{t-1}` and `x_{ t - 1 }` are the same name.
        if(s[j] === "{" && s[j - 1] === "_"){
          let d = 1, k = j + 1;
          while(k < s.length && d > 0){ if(s[k] === "{") d++; else if(s[k] === "}") d--; k++; }
          if(d > 0) throw "unclosed { in subscript";
          j = k; continue;
        }
        break;
      }
      out.push({ t: "id", v: s.slice(i, j).replace(/\s+/g, "") }); i = j; continue;
    }
    if("+-*/^(),[]|".includes(c)){ out.push({ t: c }); i++; continue; }
    if(c === "=") throw `"=" mid-expression \u2014 definitions are "name = \u2026" or "f(x) = \u2026" at the start of a line`;
    throw `unexpected "${c}"`;
  }
  return out;
}

function calcParse(tokens){
  let p = 0;
  const peek = () => tokens[p], eat = t => {
    if(!tokens[p] || tokens[p].t !== t) throw `expected ${t}`;
    return tokens[p++];
  };
  function primary(){
    const tk = peek();
    if(!tk) throw "unexpected end";
    if(tk.t === "num"){ p++; return { k: "num", v: tk.v }; }
    if(tk.t === "-"){ p++; return { k: "neg", a: primary() }; }
    if(tk.t === "("){ p++; const e = expr(); eat(")"); return e; }
    if(tk.t === "["){
      p++; const items = [];
      if(peek() && peek().t !== "]"){ items.push(expr()); while(peek() && peek().t === ","){ p++; items.push(expr()); } }
      eat("]"); return { k: "vec", items };
    }
    if(tk.t === "id"){
      p++;
      if(peek() && peek().t === "("){
        // `|` separates arguments exactly like `,` — p(z|x_t) is how the
        // notation is actually written; |x| outside a call stays an error.
        p++; const args = [];
        if(peek() && peek().t !== ")"){ args.push(expr()); while(peek() && (peek().t === "," || peek().t === "|")){ p++; args.push(expr()); } }
        eat(")"); return { k: "call", f: tk.v, args };
      }
      return { k: "var", n: tk.v };
    }
    if(tk.t === "|") throw "use abs(x), not |x|";
    throw `unexpected ${tk.t}`;
  }
  function power(){
    const a = primary();
    if(peek() && peek().t === "^"){ p++; return { k: "op", o: "^", a, b: power() }; }
    return a;
  }
  function term(){
    let a = power();
    for(;;){
      const tk = peek();
      if(tk && (tk.t === "*" || tk.t === "/")){ p++; a = { k: "op", o: tk.t, a, b: power() }; continue; }
      // Implicit multiplication, because pasted LaTeX writes `2 pi r` and
      // `3(x+1)` without stars. Adjacent factors multiply.
      if(tk && (tk.t === "num" || tk.t === "id" || tk.t === "(" || tk.t === "[")){ a = { k: "op", o: "*", a, b: power() }; continue; }
      break;
    }
    return a;
  }
  function expr(){
    let a = term();
    while(peek() && (peek().t === "+" || peek().t === "-")){ const o = tokens[p++].t; a = { k: "op", o, a, b: term() }; }
    return a;
  }
  const e = expr();
  if(p < tokens.length) throw `unexpected ${tokens[p].t}`;
  return e;
}

const isMat = v => Array.isArray(v) && Array.isArray(v[0]);

function matMul(A, B){
  if(A[0].length !== B.length) throw `matmul: ${A.length}\u00d7${A[0].length} \u00b7 ${B.length}\u00d7${B[0].length}`;
  return A.map(r => B[0].map((_, j) => r.reduce((s2, x, k) => s2 + x * B[k][j], 0)));
}

function calcZip(o, a, b){
  // Matrix-regning: + og - elementvis, * er MATRIXPRODUKT (og matrix·vektor),
  // skalar mod matrix er elementvis. Division mellem matricer er bevidst en
  // fejl — skriv inv(A) * b, så antagelsen er synlig.
  const ma = isMat(a), mb = isMat(b);
  if(ma || mb){
    if(o === "*"){
      if(ma && mb) return matMul(a, b);
      if(ma && Array.isArray(b)){ const r = matMul(a, b.map(x => [x])); return r.map(row => row[0]); }
      if(mb && Array.isArray(a)){ const r = matMul([a], b); return r[0]; }
      if(ma) return a.map(row => row.map(x => x * b));
      return b.map(row => row.map(x => a * x));
    }
    if(o === "+" || o === "-"){
      const f = o === "+" ? (x, y) => x + y : (x, y) => x - y;
      if(ma && mb){
        if(a.length !== b.length || a[0].length !== b[0].length) throw "matrix dims differ";
        return a.map((row, i) => row.map((x, j) => f(x, b[i][j])));
      }
      throw "matrix " + o + " non-matrix";
    }
    if(o === "/" && ma && typeof b === "number"){ if(b === 0) throw "division by zero"; return a.map(row => row.map(x => x / b)); }
    if(o === "^" && ma && b === -1) return matInv(a);
    throw `"${o}" is not defined for matrices` + (o === "/" ? " — use inv(A) * b" : "");
  }
  const f = { "+": (x, y) => x + y, "-": (x, y) => x - y, "*": (x, y) => x * y,
              "/": (x, y) => { if(y === 0) throw "division by zero"; return x / y; },
              "^": (x, y) => x ** y }[o];
  const va = Array.isArray(a), vb = Array.isArray(b);
  if(va && vb){
    if(a.length !== b.length) throw `length ${a.length} vs ${b.length}`;
    return a.map((x, i) => f(x, b[i]));
  }
  if(va) return a.map(x => f(x, b));
  if(vb) return b.map(y => f(a, y));
  return f(a, b);
}

function calcEval(node, env){
  switch(node.k){
    case "num": return node.v;
    case "vec": {
      const items = node.items.map(it => calcEval(it, env));
      const mats = items.filter(v => Array.isArray(v)).length;
      if(mats === 0) return items;
      // Alle elementer er vektorer af samme længde → en MATRIX (liste af rækker).
      if(mats === items.length && items.every(v => Array.isArray(v) && !Array.isArray(v[0]))){
        const w = items[0].length;
        if(items.some(v => v.length !== w)) throw "matrix rows must have equal length";
        return items;
      }
      throw "mix of scalars and vectors in [ ] — a matrix is [[row], [row]]";
    }
    case "neg": { const v = calcEval(node.a, env); return Array.isArray(v) ? v.map(x => -x) : -v; }
    case "op": return calcZip(node.o, calcEval(node.a, env), calcEval(node.b, env));
    case "var": {
      if(env.has(node.n)){
        const v = env.get(node.n);
        if(v && typeof v === "object" && v.fn) throw `${node.n} is a function — call it: ${node.n}(…)`;
        return v;
      }
      if(CALC_CONST.has(node.n)) return CALC_CONST.get(node.n);
      throw `unknown: ${node.n}`;
    }
    case "call": {
      // `bel(x_t)` may be a NAMED VALUE rather than a call — resolved by its
      // spelling, BEFORE the arguments are evaluated (x_t alone may not
      // exist; the whole spelling does).
      const key = calcAppliedKey(node);
      const bound = env.get(node.f);
      const isUserFn = bound && typeof bound === "object" && bound.fn;
      if(!isUserFn && key && env.has(key)) return env.get(key);
      // `p(x_t|u_t,x_{t-1})` with no definition anywhere: the honest unknown
      // is the WHOLE applied name, not whichever argument fails first.
      if(!isUserFn && !CALC_RESERVED.has(node.f) && !env.has(node.f))
        throw key ? `unknown: ${key} — give it a value first: ${key} = …`
                  : `unknown function: ${node.f}`;
      if(isUserFn){
        if(node.args.length !== bound.params.length)
          throw `${node.f} takes ${bound.params.length} argument${bound.params.length === 1 ? "" : "s"}`;
        const local = new Map(env);
        bound.params.forEach((pn, i) => local.set(pn, calcEval(node.args[i], env)));
        return calcEval(bound.ast, local);
      }
      const args = node.args.map(a => calcEval(a, env));
      // Aggregates FLATTEN a matrix (sum of all entries is unambiguous);
      // norm/dot/dist/len stay vector-only — a "matrix norm" is a choice
      // (Frobenius? operator?) the calculator refuses to make silently.
      if(["norm","dot","dist","len"].includes(node.f) && args.some(isMat))
        throw `${node.f} takes vectors, not matrices`;
      const flat = [];
      for(const a of args){
        if(isMat(a)) for(const row of a) flat.push(...row);
        else if(Array.isArray(a)) flat.push(...a);
        else flat.push(a);
      }
      switch(node.f){
        case "sum": return flat.reduce((s, x) => s + x, 0);
        case "mean": { if(!flat.length) throw "mean of nothing"; return flat.reduce((s, x) => s + x, 0) / flat.length; }
        case "sd": {
          if(flat.length < 2) throw "sd needs 2+ values";
          const mu = flat.reduce((s, x) => s + x, 0) / flat.length;
          return Math.sqrt(flat.reduce((s, x) => s + (x - mu) ** 2, 0) / flat.length);
        }
        case "min": { if(!flat.length) throw "min of nothing"; return Math.min(...flat); }
        case "max": { if(!flat.length) throw "max of nothing"; return Math.max(...flat); }
        case "len": { if(args.length !== 1 || !Array.isArray(args[0])) throw "len(vector)"; return args[0].length; }
        case "norm": { if(args.length !== 1 || !Array.isArray(args[0])) throw "norm(vector)"; return Math.hypot(...args[0]); }
        case "dot": {
          if(args.length !== 2 || !Array.isArray(args[0]) || !Array.isArray(args[1])) throw "dot(a, b)";
          if(args[0].length !== args[1].length) throw `length ${args[0].length} vs ${args[1].length}`;
          return args[0].reduce((s, x, i) => s + x * args[1][i], 0);
        }
        case "transpose": {
          const A = args[0];
          if(!isMat(A)) throw "transpose(matrix)";
          return A[0].map((_, j) => A.map(r => r[j]));
        }
        case "identity": {
          const n = args[0];
          if(!Number.isInteger(n) || n < 1 || n > 20) throw "identity(n), 1\u202620";
          return Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => i === j ? 1 : 0));
        }
        case "det": {
          const A = args[0];
          if(!isMat(A) || A.length !== A[0].length) throw "det(square matrix)";
          return matDet(A);
        }
        case "inv": {
          const A = args[0];
          if(!isMat(A) || A.length !== A[0].length) throw "inv(square matrix)";
          return matInv(A);
        }
        case "solve": {
          const [A, b2] = args;
          if(!isMat(A) || A.length !== A[0].length) throw "solve(A, b): A square";
          if(!Array.isArray(b2) || isMat(b2) || b2.length !== A.length) throw "solve(A, b): b vector of length " + A.length;
          return gaussSolve(A, b2);
        }
        case "dist": {
          if(args.length !== 2 || !Array.isArray(args[0]) || !Array.isArray(args[1])) throw "dist(a, b)";
          if(args[0].length !== args[1].length) throw `length ${args[0].length} vs ${args[1].length}`;
          return Math.hypot(...args[0].map((x, i) => x - args[1][i]));
        }
        default: {
          const fn = CALC_FNS.get(node.f);   // a Map, so no prototype-chain names
          if(fn){
            if(args.length !== 1) throw `${node.f} takes 1 argument`;
            if(isMat(args[0])) return args[0].map(row => row.map(fn));
            if(Array.isArray(args[0])) return args[0].map(fn);
            return fn(args[0]);
          }
          // `x(y+1)` where x holds a VALUE is multiplication, not a call —
          // the other way pasted LaTeX writes a product.
          if(env.has(node.f) && args.length === 1) return calcZip("*", env.get(node.f), args[0]);
          throw `unknown function: ${node.f}`;
        }
      }
    }
  }
  throw "bad node";
}

/** The canonical spelling of an applied name — bel(x_t), p(z,x_t) — when
    every argument is a bare name or number; null otherwise. `|` and `,`
    both normalise to `,`, so p(z|x_t) and p(z, x_t) are the same key. */
function calcAppliedKey(node){
  const parts = [];
  for(const a of node.args){
    if(a.k === "var") parts.push(a.n);
    else if(a.k === "num") parts.push(calcFmt(a.v));
    else return null;
  }
  return `${node.f}(${parts.join(",")})`;
}

/** Gauss-elimination med partiel pivotering. Singulær → fejl, aldrig NaN. */
function gaussSolve(A0, b0){
  const n = A0.length;
  const A = A0.map((r, i) => [...r, b0[i]]);
  for(let c = 0; c < n; c++){
    let p = c;
    for(let r = c + 1; r < n; r++) if(Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if(Math.abs(A[p][c]) < 1e-12) throw "singular matrix — no unique solution";
    [A[c], A[p]] = [A[p], A[c]];
    for(let r = 0; r < n; r++){
      if(r === c) continue;
      const f = A[r][c] / A[c][c];
      for(let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}
function matDet(A0){
  const n = A0.length, A = A0.map(r => [...r]);
  let det = 1;
  for(let c = 0; c < n; c++){
    let p = c;
    for(let r = c + 1; r < n; r++) if(Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if(Math.abs(A[p][c]) < 1e-12) return 0;
    if(p !== c){ [A[c], A[p]] = [A[p], A[c]]; det = -det; }
    det *= A[c][c];
    for(let r = c + 1; r < n; r++){
      const f = A[r][c] / A[c][c];
      for(let k = c; k < n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return det;
}
function matInv(A){
  const n = A.length;
  const cols = [];
  for(let j = 0; j < n; j++){
    const e = Array.from({length: n}, (_, i) => i === j ? 1 : 0);
    cols.push(gaussSolve(A, e));
  }
  return Array.from({length: n}, (_, i) => cols.map(col => col[i]));
}

const calcFmt = v => Array.isArray(v)
  ? "[" + v.map(calcFmt).join(", ") + "]"
  : (Number.isInteger(v) ? String(v) : String(+v.toPrecision(8)));

/** Split on the one top-level `=` (outside every bracket) — the thing the
    old regex could not see past: `bel(x_t) = …` has parens on the LEFT. */
function calcSplitAssign(t){
  let d = 0;
  for(let i = 0; i < t.length; i++){
    const c = t[i];
    if("([{".includes(c)) d++;
    else if(")]}".includes(c)) d--;
    else if(c === "=" && d === 0 && t[i + 1] !== "=" && !"<>!=".includes(t[i - 1] || ""))
      return [t.slice(0, i), t.slice(i + 1)];
  }
  return null;
}

/** Does the AST mention any of these names as a variable? Decides whether
    `f(x) = …` is a function of x or just a value wearing notation. */
function calcUsesParam(node, params){
  if(!node || typeof node !== "object") return false;
  if(node.k === "var") return params.includes(node.n);
  for(const key of ["a", "b"]) if(node[key] && calcUsesParam(node[key], params)) return true;
  for(const key of ["items", "args"]) if(Array.isArray(node[key]) && node[key].some(n => calcUsesParam(n, params))) return true;
  return false;
}

function calcRun(srcText){
  const env = new Map();
  const out = [];
  srcText.split("\n").forEach((line, i) => {
    const t = line.trim();
    if(!t || t.startsWith("#") || t.startsWith("%")) return;
    try {
      const split = calcSplitAssign(t);
      let name = null, params = null, exprSrc = t;
      if(split){
        // The LHS goes through the same normaliser+tokenizer as everything
        // else, so `x_{t-1} =`, `bel(x_t) =` and `p(z|x_t) =` all read.
        let lhs = null;
        try { lhs = calcTokens(latexPre(split[0])); } catch { /* not an assignable LHS: the whole line is an expression */ }
        if(lhs && lhs.length === 1 && lhs[0].t === "id"){
          name = lhs[0].v; exprSrc = split[1];
        } else if(lhs && lhs.length >= 4 && lhs[0].t === "id" && lhs[1].t === "("
                  && lhs[lhs.length - 1].t === ")"
                  && lhs.slice(2, -1).every((tk, k) => k % 2 === 0 ? tk.t === "id" : (tk.t === "," || tk.t === "|"))
                  && lhs.length % 2 === 0){
          name = lhs[0].v;
          params = lhs.slice(2, -1).filter((_, k) => k % 2 === 0).map(tk => tk.v);
          exprSrc = split[1];
        }
        if(name && CALC_RESERVED.has(name)) throw `${name} is built in — pick another name`;
      }
      const ast = calcParse(calcTokens(latexPre(exprSrc)));
      if(params){
        // Evaluate first: when every name already resolves, `bel(x_t) = …`
        // is a VALUE named bel(x_t) — the way the notation is used in a
        // filter calculation. Only a body that NEEDS the parameters
        // becomes a function.
        try {
          const v = calcEval(ast, env);
          if(typeof v === "number" && !Number.isFinite(v)) throw "not finite";
          env.set(`${name}(${params.join(",")})`, v);
          out.push(`${i + 1}: ${name}(${params.join(",")}) = ${calcFmt(v)}`);
        } catch(err){
          if(!calcUsesParam(ast, params)) throw err;
          env.set(name, { fn: true, params, ast });
          out.push(`${i + 1}: ${name}(${params.join(", ")}) defined`);
        }
        return;
      }
      const v = calcEval(ast, env);
      if(typeof v === "number" && !Number.isFinite(v)) throw "not finite";
      if(name) env.set(name, v);
      out.push(`${i + 1}: ${name ? name + " = " : ""}${calcFmt(v)}`);
    } catch(err){
      out.push(`<span class="err">${i + 1}: ${esc(String(err))}</span>`);
    }
  });
  return out.join("\n") || "—";
}
export { calcRun };
