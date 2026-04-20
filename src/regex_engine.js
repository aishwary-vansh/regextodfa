// ─── State ──────────────────────────────────────────────────────────────────
class State {
  constructor(id) {
    this.id = id;
    this.transitions = {}; // symbol → Set of state IDs
    this.isAccept = false;
  }
  add(sym, id) {
    if (!this.transitions[sym]) this.transitions[sym] = new Set();
    this.transitions[sym].add(id);
  }
}

// ─── NFA fragment (Thompson) ─────────────────────────────────────────────────
class NFAFragment {
  constructor(start, accept) {
    this.start = start;   // state ID
    this.accept = accept; // state ID
  }
}

// ─── RegexEngine ─────────────────────────────────────────────────────────────
export class RegexEngine {
  constructor(re) {
    this.re   = re;
    this.alpha = new Set();   // alphabet (no ε)
    this.cnt  = 0;
    this.S    = new Map();    // id → State  (NFA states)
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  _mk() {
    const s = new State(this.cnt++);
    this.S.set(s.id, s);
    return s;
  }

  // ── Step 1 : insert explicit '.' concatenation ───────────────────────────
  // Insert '.' between L and R when:
  //   L can END   an expression : literal, ), *, +, ?   (not ( or |)
  //   R can START an expression : literal, (            (not ), |, *, +, ?)
  _concat(exp) {
    let r = '';
    for (let i = 0; i < exp.length; i++) {
      r += exp[i];
      if (i + 1 < exp.length) {
        const L = exp[i], R = exp[i + 1];
        const lEnds   = L !== '(' && L !== '|';
        const rStarts = R !== ')' && R !== '|' && R !== '*' && R !== '+' && R !== '?';
        if (lEnds && rStarts) r += '.';
      }
    }
    return r;
  }

  // ── Step 2 : shunting-yard → postfix ────────────────────────────────────
  _postfix(exp) {
    const prec = { '|': 1, '.': 2, '?': 3, '*': 3, '+': 3 };
    let out = '', stk = [];
    for (const c of exp) {
      if (!['|', '.', '*', '+', '?', '(', ')'].includes(c)) {
        out += c;
        this.alpha.add(c);
      } else if (c === '(') {
        stk.push(c);
      } else if (c === ')') {
        while (stk.length && stk[stk.length - 1] !== '(') out += stk.pop();
        stk.pop(); // discard '('
      } else {
        while (
          stk.length &&
          stk[stk.length - 1] !== '(' &&
          prec[stk[stk.length - 1]] >= prec[c]
        ) out += stk.pop();
        stk.push(c);
      }
    }
    while (stk.length) out += stk.pop();
    return out;
  }

  // ── Step 3 : Thompson's NFA construction ────────────────────────────────
  _buildNFA(pf) {
    const stk = [];
    const EPS = 'ε';

    for (const c of pf) {
      if (!['|', '.', '*', '+', '?'].includes(c)) {
        // literal
        const s = this._mk(), a = this._mk();
        s.add(c, a.id);
        stk.push(new NFAFragment(s.id, a.id));

      } else if (c === '.') {
        // concatenation: L · R
        const R = stk.pop(), L = stk.pop();
        this.S.get(L.accept).add(EPS, R.start);
        stk.push(new NFAFragment(L.start, R.accept));

      } else if (c === '|') {
        // union: L | R
        const R = stk.pop(), L = stk.pop();
        const s = this._mk(), a = this._mk();
        s.add(EPS, L.start);
        s.add(EPS, R.start);
        this.S.get(L.accept).add(EPS, a.id);
        this.S.get(R.accept).add(EPS, a.id);
        stk.push(new NFAFragment(s.id, a.id));

      } else if (c === '*') {
        // Kleene star
        const n = stk.pop();
        const s = this._mk(), a = this._mk();
        s.add(EPS, n.start);
        s.add(EPS, a.id);            // skip (zero times)
        this.S.get(n.accept).add(EPS, n.start); // loop back
        this.S.get(n.accept).add(EPS, a.id);    // exit
        stk.push(new NFAFragment(s.id, a.id));

      } else if (c === '+') {
        // one-or-more: N must match at least once, then optionally loop
        // Reuse n.start as the entry (no skip arc), add a new accept state.
        const n = stk.pop();
        const a = this._mk();
        this.S.get(n.accept).add(EPS, n.start); // loop back for repetition
        this.S.get(n.accept).add(EPS, a.id);    // exit to new accept
        stk.push(new NFAFragment(n.start, a.id)); // start IS n.start (must enter at least once)

      } else if (c === '?') {
        // zero-or-one: new start can skip directly to new accept, or go through n
        const n = stk.pop();
        const s = this._mk(), a = this._mk();
        s.add(EPS, n.start);         // take the sub-expression
        s.add(EPS, a.id);            // or skip it entirely
        this.S.get(n.accept).add(EPS, a.id); // sub-expression leads to new accept
        stk.push(new NFAFragment(s.id, a.id));
      }
    }

    const frag = stk.pop();
    this.S.get(frag.accept).isAccept = true;
    this.nfaStart = frag.start;
    return frag;
  }

  // ── Step 4 : ε-closure ──────────────────────────────────────────────────
  _eClosure(ids) {
    const stk = [...ids];
    const cl  = new Set(ids);
    while (stk.length) {
      const st = this.S.get(stk.pop());
      if (st && st.transitions['ε']) {
        for (const nx of st.transitions['ε']) {
          if (!cl.has(nx)) { cl.add(nx); stk.push(nx); }
        }
      }
    }
    return cl;
  }

  // Canonical ID for a set of NFA state IDs
  _sid(s) { return [...s].sort((a, b) => a - b).join(','); }

  // ── Step 5 : Subset Construction → DFA ──────────────────────────────────
  _buildDFA(nfaFrag) {
    const alpha = [...this.alpha];    // no ε here
    const init  = this._eClosure([nfaFrag.start]);
    const startId = this._sid(init);

    this.DFA = new Map();
    const queue = [init];

    this.DFA.set(startId, {
      id:       startId,
      nfaS:     init,
      trans:    {},
      isAccept: [...init].some(i => this.S.get(i).isAccept),
      isStart:  true,
    });

    while (queue.length) {
      const cur   = queue.shift();
      const curId = this._sid(cur);
      const curSt = this.DFA.get(curId);

      for (const sym of alpha) {
        const raw = new Set();
        for (const id of cur) {
          const st = this.S.get(id);
          if (st.transitions[sym])
            for (const nx of st.transitions[sym]) raw.add(nx);
        }
        if (!raw.size) continue;

        const cl   = this._eClosure([...raw]);
        const clId = this._sid(cl);

        if (!this.DFA.has(clId)) {
          this.DFA.set(clId, {
            id:       clId,
            nfaS:     cl,
            trans:    {},
            isAccept: [...cl].some(i => this.S.get(i).isAccept),
            isStart:  false,
          });
          queue.push(cl);
        }
        curSt.trans[sym] = clId;
      }
    }
  }

  // ── Step 6 : Hopcroft minimization ──────────────────────────────────────
  _minimize() {
    const alpha = [...this.alpha];   // no ε

    // ── Initial partition: accept vs reject ──────────────────────────────
    let acc = new Set(), rej = new Set();
    for (const [id, st] of this.DFA) {
      (st.isAccept ? acc : rej).add(id);
    }

    // P = array of partition groups (each is a Set of DFA state IDs)
    // Keeping P as an array (not Set) avoids reference-identity pitfalls
    // and lets us replace groups by index.
    let P = [acc, rej].filter(g => g.size > 0);

    // Worklist: start with the SMALLER of the two initial groups
    // (standard Hopcroft optimisation)
    let W = [...P];   // copy of initial groups

    while (W.length) {
      const A = W.pop();   // pick any group from worklist

      for (const sym of alpha) {
        // X = set of DFA states that have a transition INTO some state in A via sym
        const X = new Set();
        for (const [id, st] of this.DFA) {
          if (st.trans[sym] !== undefined && A.has(st.trans[sym])) X.add(id);
        }
        if (!X.size) continue;

        // Try to split each partition group Y
        const nextP = [];
        for (const Y of P) {
          const I = new Set([...Y].filter(x =>  X.has(x)));   // Y ∩ X
          const D = new Set([...Y].filter(x => !X.has(x)));   // Y \ X

          if (I.size > 0 && D.size > 0) {
            nextP.push(I, D);

            // Update worklist: if Y was in W, replace by I and D.
            //   Otherwise add the SMALLER of the two.
            const inW = W.findIndex(w => _sameSet(w, Y));
            if (inW >= 0) {
              W.splice(inW, 1, I, D);
            } else {
              W.push(I.size <= D.size ? I : D);
            }
          } else {
            nextP.push(Y);
          }
        }
        P = nextP;
      }
    }

    // ── Assign Min-DFA state IDs (start state → q0) ──────────────────────
    this.MIN = new Map();
    let counter = 0;
    const old2new = new Map();  // old DFA id → new MIN id string

    // Find which partition contains the DFA start state
    const startGroup = P.find(g => [...g].some(id => this.DFA.get(id).isStart));

    // Assign q0 to the start group first
    if (startGroup) {
      const ni = `q${counter++}`;
      for (const id of startGroup) old2new.set(id, ni);
    }

    // Assign remaining groups in a DETERMINISTIC order:
    // sort each group's representative DFA state by their INDEX in DFA insertion order
    const dfaOrder = [...this.DFA.keys()]; // insertion order = BFS order
    const repOf = g => [...g].reduce((best, id) =>
      dfaOrder.indexOf(id) < dfaOrder.indexOf(best) ? id : best
    );

    // Sort non-start groups by their representative's BFS index
    const otherGroups = P
      .filter(g => g !== startGroup)
      .sort((a, b) => dfaOrder.indexOf(repOf(a)) - dfaOrder.indexOf(repOf(b)));

    for (const g of otherGroups) {
      const ni = `q${counter++}`;
      for (const id of g) old2new.set(id, ni);
    }

    // ── Build MIN-DFA states ──────────────────────────────────────────────
    // Use the BFS-order-sorted groups to produce the map
    const allGroups = startGroup ? [startGroup, ...otherGroups] : otherGroups;
    for (const g of allGroups) {
      const rep   = repOf(g);
      const repSt = this.DFA.get(rep);
      const nid   = old2new.get(rep);

      const tr = {};
      for (const sym of alpha) {
        if (repSt.trans[sym] !== undefined) {
          tr[sym] = old2new.get(repSt.trans[sym]);
        }
      }

      this.MIN.set(nid, {
        id:       nid,
        trans:    tr,
        isAccept: repSt.isAccept,
        isStart:  [...g].some(id => this.DFA.get(id).isStart),
      });
    }
  }

  // ── Public entry point ───────────────────────────────────────────────────
  run() {
    if (!this.re.trim()) throw new Error('Empty expression');

    const ec  = this._concat(this.re);
    const pf  = this._postfix(ec);
    if (!pf)  throw new Error('Invalid expression');

    const nfaFrag = this._buildNFA(pf);
    this._buildDFA(nfaFrag);
    this._minimize();

    return {
      ec,
      pf,
      nfaStart: nfaFrag.start,
      S:        this.S,
      DFA:      this.DFA,
      MIN:      this.MIN,
      alpha:    [...this.alpha],
    };
  }
}

// ── Utility: deep set equality ──────────────────────────────────────────────
function _sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ── Regex validator (unchanged) ──────────────────────────────────────────────
export function validateRegex(s) {
  if (!s.trim()) return 'Expression is empty';
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') d++;
    else if (c === ')') {
      d--;
      if (d < 0) return 'Unmatched closing parenthesis';
    }
    if (['*', '+', '?', '|'].includes(c) && i === 0)
      return `Operator '${c}' cannot start an expression`;
    if (c === '|' && i === s.length - 1)
      return "Expression cannot end with '|'";
    if (c === '|' && s[i + 1] === ')')
      return 'Empty alternation branch';
  }
  if (d > 0) return `${d} unclosed parenthesis${d > 1 ? 'es' : ''}`;
  return null;
}
