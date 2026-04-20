import { useState, useEffect, useRef } from 'react';
import { RegexEngine, validateRegex } from './core/RegexEngine';
import CytoscapeGraph from './components/CytoscapeGraph';
import { Download, Maximize, HelpCircle, Play, Pause, RefreshCw, ChevronRight } from 'lucide-react';

export default function App() {
  const [regexStr, setRegexStr] = useState('(a|b)*abb');
  const [testStr, setTestStr] = useState('abababb');
  const [data, setData] = useState(null);
  const [view, setView] = useState('nfa');
  const [error, setError] = useState(null);
  
  // Simulation State
  // NOTE: 'min' is stored inside simState so that step() uses prev.min (never stale),
  // instead of reading 'data' from the outer closure which can change during simulation.
  const [simState, setSimState] = useState({
    on: false, str: '', idx: 0, cur: null, dead: false, trace: [], result: null, auto: false,
    min: null  // snapshot of data.MIN at simulation start
  });
  
  const cyRef = useRef(null);
  const autoSimRef = useRef(null);
  const inputRef = useRef(null);   // for ε insertion

  // Insert ε at the current cursor position in the regex input
  const insertEps = () => {
    const el = inputRef.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const next = regexStr.slice(0, s) + 'ε' + regexStr.slice(e);
    setRegexStr(next);
    // Restore focus & cursor after React re-render
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + 1, s + 1);
    });
  };

  useEffect(() => {
    compile(regexStr);
  }, []);

  // Use a ref to always have the latest step() so the setTimeout callback is never stale.
  const stepRef = useRef(null);
  useEffect(() => { stepRef.current = step; });

  useEffect(() => {
    if (simState.auto && !simState.result && !simState.dead) {
      autoSimRef.current = setTimeout(() => stepRef.current(), 650);
    } else {
      clearTimeout(autoSimRef.current);
    }
    return () => clearTimeout(autoSimRef.current);
  }, [simState.auto, simState.idx, simState.dead, simState.result]);

  const compile = (r = regexStr) => {
    resetSim();
    const err = validateRegex(r);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    try {
      const eng = new RegexEngine(r);
      const res = eng.run();
      setData(res);
      setView('nfa');
    } catch (e) {
      setError("Error: " + e.message);
    }
  };

  const startSim = () => {
    if (!data) return;
    
    // Validate characters against alphabet
    for (const c of testStr) {
      if (!data.alpha.includes(c)) {
        setError(`Character '${c}' not in alphabet {${data.alpha.join(',')}}`);
        return;
      }
    }
    setError(null);
    setView('mindfa');
    
    let startState = null;
    for (const [id, st] of data.MIN) {
      if (st.isStart) { startState = id; break; }
    }

    // Snapshot MIN into simState so step() reads prev.min, never a stale closure
    const minSnapshot = data.MIN;

    // Empty string: resolve immediately without needing an extra Step press
    if (testStr.length === 0) {
      const startSt = minSnapshot.get(startState);
      const accept = startSt && startSt.isAccept;
      setSimState({
        on: true, str: '', idx: 0, cur: startState, dead: false, min: minSnapshot,
        result: accept ? 'ok' : 'fail', auto: false,
        trace: [
          { type: 'cur', msg: `▶ Start at ${startState}` },
          { type: accept ? 'ok' : 'fail', msg: accept ? 'ACCEPTED ✓ (empty string ε)' : 'REJECTED ✗ (empty string ε)' }
        ]
      });
      return;
    }

    setSimState({
      on: true,
      str: testStr,
      idx: 0,
      cur: startState,
      dead: false,
      min: minSnapshot,
      trace: [{ type: 'cur', msg: `▶ Start at ${startState}` }],
      result: null,
      auto: false
    });
  };

  const step = () => {
    setSimState(prev => {
      if (!prev.on || prev.result !== null || prev.dead) return prev;
      
      // Use prev.min (snapshotted at simulation start) — never reads stale outer 'data'
      const st = prev.min.get(prev.cur);
      
      // All characters consumed: evaluate acceptance now
      if (prev.idx >= prev.str.length) {
        const accept = st && st.isAccept;
        return {
          ...prev,
          result: accept ? 'ok' : 'fail',
          auto: false,
          trace: [...prev.trace, { type: accept ? 'ok' : 'fail', msg: accept ? 'ACCEPTED ✓' : 'REJECTED ✗' }]
        };
      }
      
      const char = prev.str[prev.idx];
      const nxt = st ? st.trans[char] : null;
      
      if (nxt === undefined || nxt === null) {
        return {
          ...prev,
          dead: true,
          result: 'fail',
          auto: false,
          trace: [...prev.trace, { type: 'fail', msg: `✗ No transition from ${prev.cur} on '${char}' — dead state` }]
        };
      }
      
      return {
        ...prev,
        cur: nxt,
        idx: prev.idx + 1,
        trace: [...prev.trace, { type: 'cur', msg: `δ(${prev.cur}, '${char}') = ${nxt}` }]
      };
    });
  };

  const toggleAuto = () => {
    setSimState(prev => ({ ...prev, auto: !prev.auto }));
  };

  const resetSim = () => {
    setSimState({ on: false, str: '', idx: 0, cur: null, dead: false, trace: [], result: null, auto: false, min: null });
  };

  const exportPNG = () => {
    if (!cyRef.current) return;
    try {
      // Use 'blob' output to handle large graphs reliably (base64 URIs can break in some browsers)
      const blob = cyRef.current.png({ output: 'blob', full: true, scale: 2.5, bg: '#ffffff' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `automata-${view}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  return (
    <div className="main" style={{ flexDirection: 'column' }}>
      <header>
        <div className="logo">
          <img src="/logo.svg" alt="SigmaX Logo" className="logo-img" />
          <div>
            <div className="logo-text">Sigma<em>X</em></div>
            <div className="logo-sub">Regex → DFA Visualizer</div>
          </div>
        </div>
        
        <div className="pipeline">
          <div className="pip done"><div className="num">1</div>Regex</div>
          <div className="pip-arrow">→</div>
          <div className="pip done"><div className="num">2</div>NFA</div>
          <div className="pip-arrow">→</div>
          <div className="pip done"><div className="num">3</div>DFA</div>
          <div className="pip-arrow">→</div>
          <div className="pip done"><div className="num">4</div>Min-DFA</div>
        </div>

        <div className="header-btns">
          <button className="hbtn" onClick={exportPNG} title="Export graph"><Download size={14} /></button>
          <button className="hbtn" onClick={() => cyRef.current?.fit()} title="Fit graph"><Maximize size={14} /></button>
          <button className="hbtn" title="Help"><HelpCircle size={14} /></button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <aside className="sidebar">
          <div className="sb-scroll">
            <div>
              <div className="sec-label">Regular Expression</div>
              <div className="ig">
                <input 
                  ref={inputRef}
                  type="text" 
                  value={regexStr} 
                  onChange={e => setRegexStr(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && compile(e.target.value)} 
                  className={error ? 'err' : ''}
                  spellCheck="false" 
                />
                <button
                  className="btn btn-eps"
                  onClick={insertEps}
                  title="Insert epsilon (empty string)"
                  type="button"
                >ε</button>
                <button className="btn btn-p" onClick={() => compile()}>Compile</button>
              </div>
              {error && <div className="err-msg show">{error}</div>}
            </div>

            <div>
              <div className="sec-label">Examples</div>
              <div className="ex-list">
                {[
                  { r: '(a|b)*abb', d: 'Ends with "abb"' },
                  { r: 'a(a|b)*b', d: "Starts 'a', ends 'b'" },
                  { r: '(aa|bb)*', d: 'Even a-pairs or b-pairs' }
                ].map(ex => (
                  <button key={ex.r} className="ex-item" onClick={() => { setRegexStr(ex.r); compile(ex.r); }}>
                    <span className="ex-re">{ex.r}</span>
                    <span className="ex-desc">{ex.d}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="sec-label">String Simulator</div>
              <div className="ig">
                <input 
                  type="text" 
                  value={testStr} 
                  onChange={e => setTestStr(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && startSim()} 
                  placeholder="Test string..." 
                  spellCheck="false" 
                />
                <button className="btn btn-s" onClick={startSim}><Play size={14} /> Test</button>
              </div>
              <div className="sim-row">
                <button className="btn btn-g" disabled={!simState.on || simState.result !== null || simState.dead} onClick={step}><ChevronRight size={14} /> Step</button>
                <button className="btn btn-g" disabled={!simState.on || simState.result !== null || simState.dead} onClick={toggleAuto}>{simState.auto ? <Pause size={14}/> : <Play size={14} />} Auto</button>
                <button className="btn btn-g" disabled={!simState.on} onClick={resetSim}><RefreshCw size={14} /> Reset</button>
              </div>
              <div className={`status ${simState.result === 'ok' ? 'ok' : simState.result === 'fail' ? 'fail' : simState.on ? 'run' : ''}`}>
                {simState.on ? 
                  simState.result === 'ok' ? `✓ ACCEPTED "${simState.str}"` : 
                  simState.result === 'fail' ? `✗ REJECTED "${simState.str}"` : 
                  `Testing "${simState.str}" — At ${simState.cur}` 
                : (data ? 'Compiled. Enter a string to test.' : 'Compile a regex to begin.')}
              </div>
            </div>

            {simState.on && (
              <div>
                <div className="sec-label">Execution Trace</div>
                <div className="trace-box">
                  {simState.trace.map((t, i) => (
                    <div key={i} className={`tr-entry ${t.type}`}>
                      <span className="tr-n">{String(i + 1).padStart(2, '0')}</span>
                      <span>{t.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="sec-label">Automaton Stats</div>
              <div className="info-grid">
                <div className="ic"><div className="ic-val">{data ? data.S.size : '—'}</div><div className="ic-lbl">NFA States</div></div>
                <div className="ic"><div className="ic-val">{data ? data.DFA.size : '—'}</div><div className="ic-lbl">DFA States</div></div>
                <div className="ic"><div className="ic-val">{data ? data.MIN.size : '—'}</div><div className="ic-lbl">Min-DFA</div></div>
                <div className="ic"><div className="ic-val" style={{fontSize:'0.9rem', paddingTop:'4px'}}>{data ? `{${data.alpha.join(',')}}` : '—'}</div><div className="ic-lbl">Alphabet Σ</div></div>
              </div>
            </div>
          </div>
        </aside>

        <div className="vis">
          <div className="tabs">
            {['nfa', 'dfa', 'mindfa', 'table'].map(v => (
              <button key={v} className={`tab ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
                {v === 'nfa' ? 'NFA' : v === 'dfa' ? 'DFA' : v === 'mindfa' ? 'Min-DFA' : 'Δ Table'}
                {v !== 'table' && <span className="t-badge">{data ? (v === 'nfa' ? data.S.size : v === 'dfa' ? data.DFA.size : data.MIN.size) : '0'}</span>}
              </button>
            ))}
          </div>

          <div className="gw">
            {!data && (
              <div className="empty">
                <div className="empty-icon">⊛</div>
                <div className="empty-text">Enter a regular expression<br/>and click <strong>Compile</strong> to visualize<br/><br/><span style={{fontSize:'0.7rem'}}>Supports: a-z, 0-9, |, *, +, ?, (, )</span></div>
              </div>
            )}

            {data && view !== 'table' && (
              <CytoscapeGraph data={data} view={view} cyRef={cyRef} simState={simState} />
            )}

            {data && view === 'table' && (
              <TransitionTable data={data} />
            )}

            {simState.on && simState.result && (
              <div className={`result-ov ${simState.result} show`}>
                <div className="rv-text">{simState.result === 'ok' ? '✓ Accepted' : '✗ Rejected'}</div>
              </div>
            )}
          </div>

          <Tape simState={simState} />
        </div>
      </div>

      <footer className="app-footer">
        <div className="footer-left">
          <img src="/logo.svg" alt="logo" className="footer-logo" />
          <span className="footer-brand">Sigma<em>X</em></span>
          <span className="footer-sep">·</span>
          <span className="footer-copy">© {new Date().getFullYear()} Aishwary Vansh. All rights reserved.</span>
        </div>
        <div className="footer-center">
          <span className="footer-tag">v1.0.0</span>
          <span className="footer-sep">·</span>
          <span className="footer-hint">Press <kbd>Enter</kbd> to compile</span>
          <span className="footer-sep">·</span>
          <span className="footer-hint">Supports: <code>a-z 0-9 | * + ? ( ) ε</code></span>
        </div>
        <div className="footer-right">
          <a href="https://github.com/aishwary-vansh/Regex-to-DFA" target="_blank" rel="noreferrer" className="footer-btn" title="GitHub">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
            GitHub
          </a>
          <button className="footer-btn" onClick={exportPNG} title="Export current graph as PNG">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export PNG
          </button>
          <button className="footer-btn" onClick={() => cyRef.current?.fit()} title="Fit graph to view">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            Fit View
          </button>
        </div>
      </footer>
    </div>
  );
}

function Tape({ simState }) {
  if (!simState.on) return null;
  const s = simState.str;

  return (
    <div className="tape-bar">
      <div className="tape-label">Input Tape</div>
      <div className="tape-row">
        {s.length === 0 ? <div className="tc" style={{fontStyle:'italic'}}>ε</div> : 
          s.split('').map((c, j) => {
            let cls = "tc ";
            if (j < simState.idx) cls += "rd";
            else if (j === simState.idx) cls += "cur";
            else cls += "un";
            return <div key={j} className={cls}>{c}</div>;
          })
        }
        {simState.idx >= s.length && <div className="tc" style={{opacity: 0.5}}>⊣</div>}
      </div>
    </div>
  );
}

function TransitionTable({ data }) {
  const alpha = data.alpha.filter(c => c !== 'ε');

  // Build a short label for DFA states (D0, D1, ...) based on BFS insertion order
  const dfaKeys = [...data.DFA.keys()];
  const dfaLabel = id => `D${dfaKeys.indexOf(id)}`;

  const legendDot = (isStart, isAccept) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {isStart  && <span title="Start"  style={{ width: 8, height: 8, background: '#7c3aed', borderRadius: '50%', display:'inline-block' }} />}
      {isAccept && <span title="Accept" style={{ width: 8, height: 8, border: '2px solid #059669', borderRadius: '50%', display:'inline-block' }} />}
    </span>
  );

  const makeTable = (entries, labelFn, transFn, title) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: '#7c3aed', marginBottom: 8 }}>{title}</div>
      <table>
        <thead>
          <tr>
            <th className="sc">State</th>
            {alpha.map(a => <th key={a}>{a}</th>)}
          </tr>
        </thead>
        <tbody>
          {entries.map(([id, st]) => (
            <tr key={id}>
              <td>
                <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}>
                  {legendDot(st.isStart, st.isAccept)}
                  <span style={{ fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{labelFn(id)}</span>
                </div>
              </td>
              {alpha.map(a => {
                const tgt = transFn(st, a);
                return <td key={a} style={{ color: tgt ? '#2563eb' : '#94a3b8' }}>{tgt || '∅'}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="tbl-view">
      {makeTable(
        [...data.DFA],
        dfaLabel,
        (st, a) => st.trans[a] ? dfaLabel(st.trans[a]) : null,
        'DFA Transition Table'
      )}
      {makeTable(
        [...data.MIN],
        id => id,
        (st, a) => st.trans[a] || null,
        'Min-DFA Transition Table'
      )}
    </div>
  );
}
