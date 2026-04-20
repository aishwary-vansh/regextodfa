import './style.css';
import cytoscape from 'cytoscape';
import { RegexEngine } from './regex_engine.js';

let cy;
let currentEngine = null;
let currentView = 'nfa';

// Elements
const regexInput = document.getElementById('regex-input');
const btnCompile = document.getElementById('btn-compile');
const exampleBtns = document.querySelectorAll('.btn-example');
const stringInput = document.getElementById('string-input');
const btnSimulate = document.getElementById('btn-simulate');
const btnStep = document.getElementById('btn-step');
const btnReset = document.getElementById('btn-reset');
const statusIndicator = document.getElementById('simulation-status');
const tabs = document.querySelectorAll('.tab');

const infoAlphabet = document.getElementById('info-alphabet');
const infoNfa = document.getElementById('info-nfa');
const infoDfa = document.getElementById('info-dfa');
const infoMinDfa = document.getElementById('info-mindfa');

// Cytoscape initialization
function initCytoscape() {
    cy = cytoscape({
        container: document.getElementById('cy'),
        style: [
            {
                selector: 'node',
                style: {
                    'background-color': '#1f2833',
                    'border-width': 2,
                    'border-color': '#66fcf1',
                    'label': 'data(label)',
                    'color': '#fff',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': '12px',
                    'font-family': 'JetBrains Mono',
                    'width': '40px',
                    'height': '40px'
                }
            },
            {
                selector: 'node[?isAccept]',
                style: {
                    'border-width': 4,
                    'border-color': '#4caf50',
                    'border-style': 'double' // Standard notation for accept state
                }
            },
            {
                selector: 'node[?isStart]',
                style: {
                    'background-color': '#45a29e'
                }
            },
            {
                selector: 'node.highlight',
                style: {
                    'background-color': '#ffeb3b',
                    'color': '#000',
                    'border-color': '#ff9800',
                    'transition-property': 'background-color, border-color, color',
                    'transition-duration': '0.3s'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#45a29e',
                    'target-arrow-color': '#45a29e',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': '10px',
                    'color': '#66fcf1',
                    'text-background-color': '#0b0c10',
                    'text-background-opacity': 0.8,
                    'text-background-padding': '2px',
                    'control-point-step-size': 40
                }
            },
            {
                selector: 'edge.highlight',
                style: {
                    'line-color': '#ff9800',
                    'target-arrow-color': '#ff9800',
                    'width': 4,
                    'transition-property': 'line-color, target-arrow-color, width',
                    'transition-duration': '0.3s'
                }
            }
        ],
        layout: { name: 'preset' }
    });
}

function renderGraph(viewMode) {
    if (!currentEngine || !cy) return;
    
    let nodes = [];
    let edges = [];
    
    if (viewMode === 'nfa') {
        const { states, nfaStart } = currentEngine;
        for (let [id, state] of states.entries()) {
            nodes.push({ data: { id: `n${id}`, label: `${id}`, isAccept: state.isAccept, isStart: id === nfaStart } });
            
            for (let [symbol, targetIds] of Object.entries(state.transitions)) {
                for (let targetId of targetIds) {
                    // cytoscape doesn't handle multiple edges between same nodes well without Multi-graphs plugin or curve-style bezier
                    edges.push({ data: { id: `e_${id}_${targetId}_${symbol}`, source: `n${id}`, target: `n${targetId}`, label: symbol } });
                }
            }
        }
    } else if (viewMode === 'dfa') {
        const { dfaStates } = currentEngine;
        for (let [id, state] of dfaStates.entries()) {
            nodes.push({ data: { id: `d${id}`, label: state.id || '{}', isAccept: state.isAccept, isStart: state.isStart } });
            
            for (let [symbol, targetId] of Object.entries(state.transitions)) {
                edges.push({ data: { id: `e_${id}_${targetId}_${symbol}`, source: `d${id}`, target: `d${targetId}`, label: symbol } });
            }
        }
    } else if (viewMode === 'mindfa') {
        const { minDFAStates } = currentEngine;
        for (let [id, state] of minDFAStates.entries()) {
            nodes.push({ data: { id: `m${id}`, label: id, isAccept: state.isAccept, isStart: state.isStart } });
            
            for (let [symbol, targetId] of Object.entries(state.transitions)) {
                edges.push({ data: { id: `e_${id}_${targetId}_${symbol}`, source: `m${id}`, target: `m${targetId}`, label: symbol } });
            }
        }
    }

    cy.elements().remove();
    cy.add([...nodes, ...edges]);
    
    // Choose layout based on size to ensure performance
    cy.layout({
        name: 'cose',
        idealEdgeLength: 60,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: true,
        componentSpacing: 100,
        nodeRepulsion: 400000,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
        animate: true
    }).run();
}

function compileRegex() {
    const val = regexInput.value.trim();
    if (!val) return;
    
    try {
        const engine = new RegexEngine(val);
        currentEngine = engine.process();
        
        infoAlphabet.textContent = currentEngine.alphabet.join(', ');
        infoNfa.textContent = currentEngine.states.size;
        infoDfa.textContent = currentEngine.dfaStates.size;
        infoMinDfa.textContent = currentEngine.minDFAStates.size;
        
        resetSimulation();
        renderGraph(currentView);
        statusIndicator.textContent = "Regex compiled successfully.";
        statusIndicator.className = "status-indicator accept";
    } catch (e) {
        statusIndicator.textContent = "Error compiling Regex: " + e.message;
        statusIndicator.className = "status-indicator reject";
        console.error(e);
    }
}

// Simulation logic
let simString = "";
let simIndex = 0;
let simCurrentState = null;
let simPath = []; // store trace

function startSimulation() {
    if (!currentEngine || currentView !== 'mindfa') {
        // Switch to minDFA view for easiest simulation visualization
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelector('[data-view="mindfa"]').classList.add('active');
        currentView = 'mindfa';
        renderGraph(currentView);
    }

    simString = stringInput.value;
    simIndex = 0;
    simPath = [];
    
    // Find start state
    for (let [id, state] of currentEngine.minDFAStates.entries()) {
        if (state.isStart) {
            simCurrentState = id;
            break;
        }
    }
    
    btnStep.disabled = false;
    btnReset.disabled = false;
    
    highlightNode(simCurrentState);
    statusIndicator.textContent = `Testing string: "${simString}". At start state ${simCurrentState}.`;
    statusIndicator.className = "status-indicator";
}

function highlightNode(nodeId, edgeId = null) {
    cy.elements().removeClass('highlight');
    if (nodeId) cy.getElementById(`m${nodeId}`).addClass('highlight');
    if (edgeId) cy.getElementById(edgeId).addClass('highlight');
}

function stepSimulation() {
    if (simIndex >= simString.length) {
        // Finished
        let state = currentEngine.minDFAStates.get(simCurrentState);
        if (state.isAccept) {
            statusIndicator.textContent = `Accepted: "${simString}"`;
            statusIndicator.className = "status-indicator accept";
        } else {
            statusIndicator.textContent = `Rejected: "${simString}"`;
            statusIndicator.className = "status-indicator reject";
        }
        btnStep.disabled = true;
        return;
    }
    
    let char = simString[simIndex];
    let state = currentEngine.minDFAStates.get(simCurrentState);
    let nextStateId = state.transitions[char];
    
    if (!nextStateId) {
        // Dead state
        statusIndicator.textContent = `Rejected: No transition for '${char}' at state ${simCurrentState}`;
        statusIndicator.className = "status-indicator reject";
        btnStep.disabled = true;
        
        // Cannot advance, but highlight failure
        cy.elements().removeClass('highlight');
        return;
    }
    
    let edgeId = `e_${simCurrentState}_${nextStateId}_${char}`;
    simCurrentState = nextStateId;
    simIndex++;
    
    highlightNode(simCurrentState, edgeId);
    
    let remaining = simString.substring(simIndex);
    if (remaining) {
        statusIndicator.textContent = `Consumed '${char}'. Next: "${remaining}". Current: ${simCurrentState}`;
    } else {
        // Evaluate accept/reject immediately at end of string
        let finState = currentEngine.minDFAStates.get(simCurrentState);
        if (finState.isAccept) {
            statusIndicator.textContent = `Accepted: Consumed all. State ${simCurrentState} is Accept.`;
            statusIndicator.className = "status-indicator accept";
        } else {
            statusIndicator.textContent = `Rejected: Consumed all. State ${simCurrentState} is NOT Accept.`;
            statusIndicator.className = "status-indicator reject";
        }
        btnStep.disabled = true;
    }
}

function resetSimulation() {
    btnStep.disabled = true;
    btnReset.disabled = true;
    simCurrentState = null;
    cy.elements().removeClass('highlight');
    statusIndicator.textContent = "";
    statusIndicator.className = "status-indicator";
}

// Event Listeners
btnCompile.addEventListener('click', compileRegex);

exampleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        regexInput.value = btn.dataset.regex;
        compileRegex();
    });
});

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentView = tab.dataset.view;
        renderGraph(currentView);
    });
});

btnSimulate.addEventListener('click', startSimulation);
btnStep.addEventListener('click', stepSimulation);
btnReset.addEventListener('click', resetSimulation);

// Init
window.addEventListener('DOMContentLoaded', () => {
    initCytoscape();
    compileRegex(); // initial compile
});
