import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

const cyStyle = [
  {
    selector: 'node',
    style: {
      'background-color': 'rgba(255, 255, 255, 0.8)',
      'border-width': 2,
      'border-color': '#ec4899',
      'label': 'data(label)',
      'color': '#111827',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': '12px',
      'font-family': 'JetBrains Mono, monospace',
      'font-weight': '600',
      'width': '44px',
      'height': '44px',
      'transition-property': 'background-color, border-color, border-width, width, height',
      'transition-duration': '0.3s'
    }
  },
  {
    selector: 'node[?isStart]',
    style: {
      'background-color': '#f3e8ff',
      'border-color': '#9333ea'
    }
  },
  {
    selector: 'node[?isAccept]',
    style: {
      'border-width': 4,
      'border-color': '#10b981',
      'background-color': '#ecfdf5'
    }
  },
  {
    selector: 'node.hl',
    style: {
      'background-color': '#fce7f3',
      'border-color': '#ec4899',
      'border-width': 4,
      'color': '#ec4899',
      'width': '50px',
      'height': '50px',
      'font-weight': 'bold',
      'z-index': 100
    }
  },
  {
    selector: 'node.visited',
    style: {
      'background-color': '#fffbeb',
      'border-color': '#f59e0b',
      'border-width': 2,
      'color': '#d97706'
    }
  },
  {
    selector: 'node.dead',
    style: {
      'background-color': 'rgba(220, 38, 38, 0.1)',
      'border-color': '#dc2626',
      'border-width': 2
    }
  },
  {
    selector: 'edge',
    style: {
      'width': 2,
      'line-color': '#cbd5e1',
      'target-arrow-color': '#94a3b8',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'label': 'data(label)',
      'font-size': '12px',
      'font-family': 'JetBrains Mono, monospace',
      'font-weight': '600',
      'color': '#4b5563',
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '3px',
      'control-point-step-size': 40,
      'transition-property': 'line-color, width, target-arrow-color',
      'transition-duration': '0.3s'
    }
  },
  {
    selector: 'edge[label="ε"]',
    style: {
      'line-style': 'dashed',
      'line-color': '#94a3b8',
      'target-arrow-color': '#cbd5e1',
      'color': '#6b7280',
      'width': 1.5
    }
  },
  {
    selector: 'edge.hl',
    style: {
      'line-color': '#ec4899',
      'target-arrow-color': '#ec4899',
      'width': 3,
      'color': '#ec4899',
      'z-index': 100
    }
  },
  {
    selector: 'edge.visited',
    style: {
      'line-color': '#d97706',
      'target-arrow-color': '#d97706',
      'width': 2,
      'color': '#d97706'
    }
  }
];

export default function CytoscapeGraph({ data, view, cyRef, simState }) {
  const containerRef = useRef(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const cy = cytoscape({
      container: containerRef.current,
      style: cyStyle,
      layout: { name: 'preset' },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });
    
    if (cyRef) cyRef.current = cy;
    
    return () => cy.destroy();
  }, [cyRef]);

  useEffect(() => {
    if (!data || !cyRef.current) return;
    const cy = cyRef.current;
    
    const elements = buildElements(data, view);
    cy.elements().remove();
    cy.add(elements);
    applyParallelCurves(cy);
    
    // Animate layout
    cy.layout({
      name: 'dagre',
      rankDir: 'LR',
      nodeSep: 45,
      rankSep: 75,
      edgeSep: 10,
      animate: true,
      animationDuration: 350,
      fit: true,
      padding: 35
    }).run();
  }, [data, view, cyRef]);

  // Handle simulation highlighting
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    
    if (!simState.on) {
       cy.elements().removeClass('hl visited dead');
       return;
    }
    
    // Just clear hl, keep visited
    cy.elements().removeClass('hl');
    
    if (simState.cur !== null) {
      const cyNodeId = `m${simState.cur}`;
      const node = cy.getElementById(cyNodeId);
      if (simState.dead) {
         node.addClass('dead');
      } else {
         node.addClass('hl');
      }
      
      // Optionally highlight the edge that got us here? It's easier managed by App if passing edge info, 
      // but let's just highlight the node for simplicity or let App manage cy direct operations for simulation steps.
    }
  }, [simState.cur, simState.on, simState.dead, cyRef]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

function buildElements(data, v) {
  const nodes = [], edges = [];
  const eCounts = {};
  
  const addEdge = (from, to, lbl, pfx, extra = {}) => {
    const k = `${from}_${to}`;
    if (!eCounts[k]) eCounts[k] = 0;
    const idx = eCounts[k]++;
    edges.push({
      data: {
        id: `${pfx}e_${from}_${to}_${lbl}_${idx}`,
        source: `${pfx}${from}`,
        target: `${pfx}${to}`,
        label: lbl,
        ...extra
      }
    });
  };
  
  if (v === 'nfa') {
    for (const [id, st] of data.S) {
      nodes.push({ data: { id: `n${id}`, label: `q${id}`, isAccept: st.isAccept, isStart: id === data.nfaStart } });
      for (const [sym, tgts] of Object.entries(st.transitions)) 
        for (const t of tgts) addEdge(id, t, sym, 'n');
    }
    nodes.push({ data: { id: 'n_start_arrow', label: '' }, style: { 'width': 1, 'height': 1, 'background-opacity': 0 } });
    edges.push({ data: { id: 'e_start_nfa', source: 'n_start_arrow', target: `n${data.nfaStart}`, label: '' } });
  } else if (v === 'dfa') {
    // DFA state IDs are comma-separated NFA state sets — sanitize for Cytoscape.
    // Map each raw DFA id → stable numeric index
    let i = 0;
    const imap = new Map();
    for (const [id] of data.DFA) imap.set(id, i++);
    const safeId = id => `s${imap.get(id)}`;

    // Merge parallel edges: (from, to) → combined label "a,b"
    const edgeMap = new Map();
    for (const [id, st] of data.DFA) {
      for (const [sym, tgt] of Object.entries(st.trans)) {
        const key = `${imap.get(id)}|${imap.get(tgt)}`;
        if (!edgeMap.has(key)) edgeMap.set(key, { from: id, to: tgt, syms: [] });
        edgeMap.get(key).syms.push(sym);
      }
    }

    for (const [id, st] of data.DFA) {
      nodes.push({ data: { id: `d${safeId(id)}`, label: `D${imap.get(id)}`, isAccept: st.isAccept, isStart: st.isStart } });
    }
    let ei = 0;
    for (const { from, to, syms } of edgeMap.values()) {
      edges.push({
        data: {
          id: `de_${safeId(from)}_${safeId(to)}_${ei++}`,
          source: `d${safeId(from)}`,
          target: `d${safeId(to)}`,
          label: syms.sort().join(','),
        }
      });
    }

    const startEntry = [...data.DFA.entries()].find(([, s]) => s.isStart);
    if (startEntry) {
      nodes.push({ data: { id: 'd_start_arrow', label: '' }, style: { 'width': 1, 'height': 1, 'background-opacity': 0 } });
      edges.push({ data: { id: 'e_start_dfa', source: 'd_start_arrow', target: `d${safeId(startEntry[0])}`, label: '' } });
    }
  } else if (v === 'mindfa') {
    // Merge parallel edges for Min-DFA
    const edgeMap = new Map();
    for (const [id, st] of data.MIN) {
      for (const [sym, tgt] of Object.entries(st.trans)) {
        const key = `${id}|${tgt}`;
        if (!edgeMap.has(key)) edgeMap.set(key, { from: id, to: tgt, syms: [] });
        edgeMap.get(key).syms.push(sym);
      }
    }

    for (const [id, st] of data.MIN) {
      nodes.push({ data: { id: `m${id}`, label: id, isAccept: st.isAccept, isStart: st.isStart } });
    }
    let ei = 0;
    for (const { from, to, syms } of edgeMap.values()) {
      edges.push({
        data: {
          id: `me_${from}_${to}_${ei++}`,
          source: `m${from}`,
          target: `m${to}`,
          label: syms.sort().join(','),
        }
      });
    }

    const startEntry = [...data.MIN.entries()].find(([, s]) => s.isStart);
    if (startEntry) {
      nodes.push({ data: { id: 'm_start_arrow', label: '' }, style: { 'width': 1, 'height': 1, 'background-opacity': 0 } });
      edges.push({ data: { id: 'e_start_min', source: 'm_start_arrow', target: `m${startEntry[0]}`, label: '' } });
    }
  }
  return [...nodes, ...edges];
}

function applyParallelCurves(cy) {
  const groups = {};
  cy.edges().forEach(e => {
    const k = `${e.data('source')}_${e.data('target')}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(e);
  });
  for (const k in groups) {
    const g = groups[k];
    if (g.length > 1) {
      g.forEach((e, i) => {
        const offset = (i % 2 === 0 ? 1 : -1) * Math.ceil((i + 2) / 2) * 35;
        if (e.data('source') === e.data('target')) {
          e.style({ 'curve-style': 'loop', 'loop-direction': offset, 'loop-sweep': 40 });
        } else {
          e.style({ 'control-point-distances': offset, 'control-point-weights': 0.5 });
        }
      });
    } else if (g.length === 1 && g[0].data('source') === g[0].data('target')) {
      g[0].style({ 'curve-style': 'loop', 'loop-direction': 90, 'loop-sweep': 50 });
    }
  }
}
