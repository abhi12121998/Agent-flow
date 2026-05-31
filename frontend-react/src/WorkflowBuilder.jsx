import { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  Handle, Position, MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, Play, Save, Trash2, Copy, ChevronDown, Zap, GitBranch, X, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { api } from './api';

// ── Custom Node: Agent ─────────────────────────────────────────────────────
function AgentNode({ data, selected }) {
  return (
    <div style={{
      padding: '12px 16px', borderRadius: 10, minWidth: 200,
      background: selected ? '#1a2038' : 'var(--surface2)',
      border: `2px solid ${selected ? 'var(--accent)' : 'var(--border2)'}`,
      boxShadow: selected ? '0 0 20px var(--accent)30' : 'var(--shadow)',
      transition: 'all 0.15s',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--accent)', width: 10, height: 10, border: '2px solid var(--bg)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent)20',
          display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent)40' }}>
          <Zap size={12} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{data.label}</div>
          <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>{data.role || 'Agent'}</div>
        </div>
      </div>
      {data.agent_id ? (
        <div style={{ fontSize: 10, color: 'var(--accent3)', fontFamily: 'var(--mono)' }}>● Connected</div>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--warn)' }}>⚠ No agent assigned</div>
      )}
      {data.task && data.task !== '__user_input__' && (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {data.task}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: 'var(--accent)', width: 10, height: 10, border: '2px solid var(--bg)' }} />
    </div>
  );
}

// ── Custom Node: Condition ────────────────────────────────────────────────
function ConditionNode({ data, selected }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, minWidth: 160,
      background: selected ? '#1d1a10' : 'var(--surface2)',
      border: `2px solid ${selected ? 'var(--warn)' : '#f59e0b40'}`,
      boxShadow: selected ? '0 0 20px var(--warn)30' : 'var(--shadow)',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--warn)', width: 10, height: 10, border: '2px solid var(--bg)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <GitBranch size={14} style={{ color: 'var(--warn)' }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warn)' }}>Condition</div>
          <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', marginTop: 2 }}>
            {data.condition || 'keyword check'}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--warn)', width: 10, height: 10, border: '2px solid var(--bg)' }} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode, condition: ConditionNode };

let nodeIdCounter = 100;
const newId = () => `node_${++nodeIdCounter}`;

export default function WorkflowBuilder({ toast }) {
  const [workflows, setWorkflows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [agents, setAgents] = useState([]);
  const [activeWf, setActiveWf] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [runResult, setRunResult] = useState(null);
  const [showRunPanel, setShowRunPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newWfName, setNewWfName] = useState('');
  const [newWfDesc, setNewWfDesc] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [wfs, tmpl, agts] = await Promise.all([api.workflows.list(), api.workflows.templates(), api.agents.list()]);
      setWorkflows(wfs.filter(w => !w.is_template));
      setTemplates(tmpl);
      setAgents(agts);
    } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }

  function loadWorkflow(wf) {
    setActiveWf(wf);
    setSelectedNode(null);
    setRunResult(null);
    const g = wf.graph_json || { nodes: [], edges: [] };
    setNodes((g.nodes || []).map(n => ({
      id: n.id, type: n.type || 'agent',
      position: n.position || { x: Math.random() * 400, y: 200 },
      data: n.data || {},
    })));
    setEdges((g.edges || []).map(e => ({
      id: e.id || `e_${e.source}_${e.target}`,
      source: e.source, target: e.target,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
      style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
    })));
    setDirty(false);
  }

  function fromTemplate(tmpl) {
    const g = tmpl.graph_json || { nodes: [], edges: [] };
    setActiveWf({ ...tmpl, id: null, name: `${tmpl.name} (copy)`, is_template: false });
    setNodes((g.nodes || []).map(n => ({
      id: n.id, type: n.type || 'agent',
      position: n.position || { x: Math.random() * 500, y: 200 },
      data: n.data || {},
    })));
    setEdges((g.edges || []).map(e => ({
      id: e.id || `e_${e.source}_${e.target}`,
      source: e.source, target: e.target,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
      style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
    })));
    setDirty(true);
    setSelectedNode(null);
  }

  const onConnect = useCallback((params) => {
    setEdges(es => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
      style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
    }, es));
    setDirty(true);
  }, [setEdges]);

  function addAgentNode() {
    const id = newId();
    setNodes(ns => [...ns, {
      id, type: 'agent',
      position: { x: 150 + ns.length * 200, y: 200 },
      data: { label: 'New Agent', role: '', task: '__user_input__', agent_id: null },
    }]);
    setDirty(true);
  }

  function addConditionNode() {
    const id = newId();
    setNodes(ns => [...ns, {
      id, type: 'condition',
      position: { x: 150 + ns.length * 200, y: 300 },
      data: { label: 'Condition', condition: '' },
    }]);
    setDirty(true);
  }

  function deleteNode() {
    if (!selectedNode) return;
    setNodes(ns => ns.filter(n => n.id !== selectedNode.id));
    setEdges(es => es.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
    setDirty(true);
  }

  function updateNodeData(key, val) {
    setNodes(ns => ns.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, [key]: val } } : n));
    setSelectedNode(s => ({ ...s, data: { ...s.data, [key]: val } }));
    setDirty(true);
  }

  async function save() {
    if (!activeWf) return;
    const graphData = {
      nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
    };
    try {
      if (activeWf.id) {
        const updated = await api.workflows.update(activeWf.id, { graph_json: graphData, name: activeWf.name });
        setActiveWf(updated);
        toast('Workflow saved', 'success');
      } else {
        const created = await api.workflows.create({ name: activeWf.name, description: activeWf.description || '', graph_json: graphData });
        setActiveWf(created);
        toast('Workflow created', 'success');
        loadAll();
      }
      setDirty(false);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function runWorkflow() {
    if (!activeWf?.id || !runInput.trim()) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.workflows.run(activeWf.id, runInput);
      setRunResult(res);
      toast(res.status === 'completed' ? 'Workflow completed!' : 'Workflow failed', res.status === 'completed' ? 'success' : 'error');
    } catch (e) {
      toast(e.message, 'error');
    }
    setRunning(false);
  }

  async function createNew() {
    if (!newWfName.trim()) return;
    const wf = await api.workflows.create({ name: newWfName.trim(), description: newWfDesc, graph_json: { nodes: [], edges: [] } });
    setWorkflows(w => [...w, wf]);
    loadWorkflow(wf);
    setShowNewModal(false);
    setNewWfName('');
    setNewWfDesc('');
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700 }}>Workflows</span>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNewModal(true)}>
              <Plus size={12} /> New
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* My Workflows */}
          <div style={{ padding: '8px 12px 4px' }}>
            <div className="text-xs text-muted" style={{ padding: '4px 4px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>My Workflows</div>
            {workflows.length === 0 && <div className="text-xs text-muted" style={{ padding: '8px 4px' }}>No workflows yet</div>}
            {workflows.map(wf => (
              <div key={wf.id}
                onClick={() => loadWorkflow(wf)}
                style={{ padding: '8px 8px', borderRadius: 6, cursor: 'pointer', marginBottom: 2,
                  background: activeWf?.id === wf.id ? 'var(--accent)15' : 'transparent',
                  border: activeWf?.id === wf.id ? '1px solid var(--accent)30' : '1px solid transparent',
                  fontSize: 12, color: activeWf?.id === wf.id ? 'var(--accent)' : 'var(--text)' }}>
                {wf.name}
              </div>
            ))}
          </div>

          <hr className="divider" style={{ margin: '8px 12px' }} />

          {/* Templates */}
          <div style={{ padding: '0 12px 8px' }}>
            <div className="text-xs text-muted" style={{ padding: '4px 4px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Templates</div>
            {templates.map(tmpl => (
              <div key={tmpl.id}
                onClick={() => fromTemplate(tmpl)}
                style={{ padding: '8px 8px', borderRadius: 6, cursor: 'pointer', marginBottom: 2,
                  background: 'transparent', border: '1px solid transparent',
                  fontSize: 12, color: 'var(--text2)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)'; }}>
                📋 {tmpl.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!activeWf ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <GitBranch size={40} />
            <div style={{ fontFamily: 'var(--display)', fontSize: 16, fontWeight: 600, color: 'var(--text2)' }}>No workflow selected</div>
            <p>Create a new workflow or pick a template to get started.</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
                {activeWf.name} {dirty && <span style={{ color: 'var(--warn)', fontSize: 11 }}>●  unsaved</span>}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={addAgentNode}><Plus size={12} /> Agent</button>
              <button className="btn btn-secondary btn-sm" onClick={addConditionNode}><GitBranch size={12} /> Condition</button>
              {selectedNode && <button className="btn btn-danger btn-sm" onClick={deleteNode}><Trash2 size={12} /> Delete</button>}
              <button className="btn btn-secondary btn-sm" onClick={save} disabled={!dirty}><Save size={12} /> Save</button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowRunPanel(p => !p)} disabled={!activeWf?.id}>
                <Play size={12} /> Run
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* ReactFlow Canvas */}
              <div style={{ flex: 1 }}>
                <ReactFlow
                  nodes={nodes} edges={edges}
                  onNodesChange={e => { onNodesChange(e); setDirty(true); }}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={(_, node) => setSelectedNode(node)}
                  onPaneClick={() => setSelectedNode(null)}
                  nodeTypes={nodeTypes}
                  fitView
                  style={{ background: 'var(--bg)' }}
                >
                  <Background color="var(--border)" gap={24} />
                  <Controls />
                  <MiniMap nodeColor={() => 'var(--accent)'} style={{ background: 'var(--surface2)' }} />
                </ReactFlow>
              </div>

              {/* Node Editor Panel */}
              {selectedNode && (
                <div style={{ width: 280, borderLeft: '1px solid var(--border)', padding: 16, overflowY: 'auto', background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>Edit Node</span>
                    <button className="btn btn-ghost btn-icon" onClick={() => setSelectedNode(null)}><X size={14} /></button>
                  </div>

                  <div className="form-group">
                    <label>Label</label>
                    <input value={selectedNode.data.label || ''} onChange={e => updateNodeData('label', e.target.value)} />
                  </div>

                  {selectedNode.type === 'agent' && (
                    <>
                      <div className="form-group">
                        <label>Assign Agent</label>
                        <select value={selectedNode.data.agent_id || ''} onChange={e => updateNodeData('agent_id', e.target.value)}>
                          <option value="">— Select Agent —</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Task</label>
                        <textarea
                          value={selectedNode.data.task || ''}
                          onChange={e => updateNodeData('task', e.target.value)}
                          placeholder="Use __user_input__ to pass the workflow input"
                          style={{ minHeight: 80 }}
                        />
                        <span className="text-xs text-muted">Use <code style={{ fontFamily: 'var(--mono)', background: 'var(--surface3)', padding: '1px 4px', borderRadius: 3 }}>__user_input__</code> to pass initial input</span>
                      </div>
                    </>
                  )}

                  {selectedNode.type === 'condition' && (
                    <div className="form-group">
                      <label>Condition Keyword</label>
                      <input value={selectedNode.data.condition || ''} onChange={e => updateNodeData('condition', e.target.value)}
                        placeholder="e.g. success, error, approved" />
                      <span className="text-xs text-muted">If this keyword is found in upstream output, condition passes.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Run Panel */}
              {showRunPanel && (
                <div style={{ width: 320, borderLeft: '1px solid var(--border)', padding: 16, background: 'var(--surface)', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>Run Workflow</span>
                    <button className="btn btn-ghost btn-icon" onClick={() => setShowRunPanel(false)}><X size={14} /></button>
                  </div>
                  <div className="form-group">
                    <label>Input Prompt</label>
                    <textarea value={runInput} onChange={e => setRunInput(e.target.value)}
                      placeholder="What should the workflow accomplish?" style={{ minHeight: 100 }} />
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%' }} onClick={runWorkflow}
                    disabled={running || !runInput.trim()}>
                    {running ? <><span className="spinner" /> Running…</> : <><Play size={13} /> Execute</>}
                  </button>

                  {runResult && (
                    <div style={{ marginTop: 16 }}>
                      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                        {runResult.status === 'completed' ? <CheckCircle size={14} style={{ color: 'var(--accent3)' }} /> : <AlertCircle size={14} style={{ color: 'var(--danger)' }} />}
                        <span style={{ fontWeight: 600, fontSize: 12, color: runResult.status === 'completed' ? 'var(--accent3)' : 'var(--danger)' }}>
                          {runResult.status}
                        </span>
                        <span className="text-xs text-muted">{runResult.total_tokens} tokens · ${runResult.total_cost?.toFixed(5)}</span>
                      </div>
                      {runResult.output?.output && (
                        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12,
                          fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflowY: 'auto' }}>
                          {runResult.output.output}
                        </div>
                      )}
                      {runResult.error && (
                        <div style={{ background: 'var(--danger)10', border: '1px solid var(--danger)30', borderRadius: 8, padding: 12, fontSize: 12, color: 'var(--danger)' }}>
                          {runResult.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* New Workflow Modal */}
      {showNewModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowNewModal(false)}>
          <div className="modal" style={{ minWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">New Workflow</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowNewModal(false)}><X size={16} /></button>
            </div>
            <div className="form-group">
              <label>Name *</label>
              <input value={newWfName} onChange={e => setNewWfName(e.target.value)} placeholder="e.g. Daily Research Pipeline" autoFocus />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={newWfDesc} onChange={e => setNewWfDesc(e.target.value)} placeholder="What does this workflow do?" style={{ minHeight: 60 }} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createNew} disabled={!newWfName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
