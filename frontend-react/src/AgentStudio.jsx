import { useState, useEffect, useRef } from 'react';
import { Plus, Bot, Trash2, Edit2, MessageSquare, RotateCcw, ChevronRight, Zap, Clock, Brain } from 'lucide-react';
import { api } from './api';
import AgentModal from './AgentModal';

export default function AgentStudio({ toast }) {
  const [agents, setAgents] = useState([]);
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalAgent, setModalAgent] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [chatAgent, setChatAgent] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  async function load() {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([api.agents.list(), api.tools.list()]);
      setAgents(a);
      setTools(t);
    } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }

  async function handleSave(form) {
    try {
      if (modalAgent?.id) {
        await api.agents.update(modalAgent.id, form);
        toast('Agent updated', 'success');
      } else {
        await api.agents.create(form);
        toast('Agent created', 'success');
      }
      setShowModal(false);
      setModalAgent(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this agent?')) return;
    try {
      await api.agents.delete(id);
      toast('Agent deleted', 'success');
      if (chatAgent?.id === id) setChatAgent(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openChat(agent) {
    setChatAgent(agent);
    setChatMessages([]);
    try {
      const mem = await api.agents.memory(agent.id);
      setChatMessages(mem.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content })));
    } catch {}
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(m => [...m, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      const res = await api.agents.chat(chatAgent.id, msg);
      setChatMessages(m => [...m, { role: 'assistant', content: res.content,
        meta: `${res.total_tokens} tokens · $${res.total_cost?.toFixed(5)}` }]);
    } catch (e) {
      setChatMessages(m => [...m, { role: 'error', content: e.message }]);
    }
    setChatLoading(false);
  }

  async function clearMemory() {
    if (!chatAgent) return;
    await api.agents.clearMemory(chatAgent.id);
    setChatMessages([]);
    toast('Memory cleared', 'success');
  }

  const statusColor = (a) => a.is_active ? '#34d399' : '#5a6275';

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Agent List */}
      <div style={{ width: chatAgent ? 380 : '100%', borderRight: chatAgent ? '1px solid var(--border)' : 'none',
        display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700 }}>Agent Studio</h2>
            <p className="text-muted text-sm">{agents.length} agents configured</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setModalAgent(null); setShowModal(true); }}>
            <Plus size={14} /> New Agent
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {agents.length === 0 && (
            <div className="empty-state">
              <Bot size={40} />
              <div style={{ fontFamily: 'var(--display)', fontSize: 15, fontWeight: 600, color: 'var(--text2)' }}>No agents yet</div>
              <p>Create your first agent to get started.</p>
              <button className="btn btn-primary btn-sm" onClick={() => { setModalAgent(null); setShowModal(true); }}>
                <Plus size={12} /> Create Agent
              </button>
            </div>
          )}
          {agents.map(agent => (
            <div key={agent.id} className="card"
              style={{ padding: '14px 16px', cursor: 'pointer', border: chatAgent?.id === agent.id ? '1px solid var(--accent)' : undefined }}
              onClick={() => openChat(agent)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--surface2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    border: '1px solid var(--border2)' }}>
                    <Bot size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="truncate">{agent.name}</span>
                      <span className="dot" style={{ background: statusColor(agent), boxShadow: agent.is_active ? `0 0 6px ${statusColor(agent)}` : 'none', flexShrink: 0 }} />
                    </div>
                    <div className="text-muted text-xs truncate">{agent.role}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { setModalAgent(agent); setShowModal(true); }}>
                    <Edit2 size={13} />
                  </button>
                  <button className="btn btn-ghost btn-icon btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(agent.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="flex" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
                <span className="badge badge-blue">{agent.model}</span>
                {agent.tools?.length > 0 && (
                  <span className="badge badge-purple"><Zap size={9} /> {agent.tools.length} tools</span>
                )}
                {agent.memory_enabled && (
                  <span className="badge badge-gray"><Brain size={9} /> memory</span>
                )}
                {agent.schedule && (
                  <span className="badge badge-yellow"><Clock size={9} /> scheduled</span>
                )}
              </div>
              <div className="text-xs text-muted" style={{ marginTop: 8, display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {agent.system_prompt}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Panel */}
      {chatAgent && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="flex items-center gap-3">
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)20',
                display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent)40' }}>
                <Bot size={15} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{chatAgent.name}</div>
                <div className="text-xs text-muted">{chatAgent.role}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={clearMemory}>
                <RotateCcw size={12} /> Clear Memory
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => setChatAgent(null)}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {chatMessages.length === 0 && (
              <div className="empty-state" style={{ flex: 1 }}>
                <MessageSquare size={32} />
                <p>Start a conversation with {chatAgent.name}</p>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '75%',
                animation: 'slideIn 0.2s ease',
              }}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: m.role === 'user' ? 'var(--accent)' : m.role === 'error' ? 'var(--danger)15' : 'var(--surface2)',
                  color: m.role === 'user' ? '#fff' : m.role === 'error' ? 'var(--danger)' : 'var(--text)',
                  border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {m.content}
                </div>
                {m.meta && <div className="text-xs text-muted" style={{ marginTop: 4, paddingLeft: 4 }}>{m.meta}</div>}
              </div>
            ))}
            {chatLoading && (
              <div style={{ alignSelf: 'flex-start' }}>
                <div style={{ padding: '10px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '12px 12px 12px 4px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                        animation: `pulse 1s ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder={`Message ${chatAgent.name}… (Enter to send, Shift+Enter for newline)`}
              style={{ flex: 1, minHeight: 44, maxHeight: 120, resize: 'none', borderRadius: 8 }}
              rows={1}
            />
            <button className="btn btn-primary" onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ alignSelf: 'flex-end' }}>
              Send
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <AgentModal
          agent={modalAgent}
          tools={tools}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setModalAgent(null); }}
        />
      )}
    </div>
  );
}
