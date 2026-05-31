import { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

const MODELS = [
  { value: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B' },
  { value: 'llama-3.1-8b-instant',    label: 'LLaMA 3.1 8B'  },
  { value: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B'  },
  { value: 'gemma2-9b-it',            label: 'Gemma2 9B'     },
];

export default function AgentModal({ agent, tools, onSave, onClose }) {
  const isEdit = !!agent?.id;
  const [form, setForm] = useState({
    name: '',
    role: '',
    system_prompt: '',
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7,
    max_tokens: 2048,
    tools: [],
    memory_enabled: true,
    memory_window: 20,
    guardrails: { forbidden_topics: [], max_response_length: null },
    schedule: '',
    schedule_prompt: '',
    max_iterations: 10,
    ...agent,
  });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('basic');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const toggleTool = (name) => {
    set('tools', form.tools.includes(name)
      ? form.tools.filter(t => t !== name)
      : [...form.tools, name]
    );
  };

  const handleSubmit = async () => {
    if (!form.name || !form.role || !form.system_prompt) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  const tabs = ['basic', 'tools', 'memory', 'guardrails', 'schedule'];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ minWidth: 580 }}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Agent' : 'New Agent'}</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2" style={{ marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="btn btn-sm"
              style={{
                background: tab === t ? 'var(--accent)20' : 'transparent',
                color: tab === t ? 'var(--accent)' : 'var(--text2)',
                border: tab === t ? '1px solid var(--accent)40' : '1px solid transparent',
                textTransform: 'capitalize',
              }}
            >{t}</button>
          ))}
        </div>

        {/* Basic */}
        {tab === 'basic' && (
          <div className="animate-in">
            <div className="form-group">
              <label>Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Research Analyst" />
            </div>
            <div className="form-group">
              <label>Role *</label>
              <input value={form.role} onChange={e => set('role', e.target.value)} placeholder="e.g. Researcher, Summarizer, Editor" />
            </div>
            <div className="form-group">
              <label>System Prompt *</label>
              <textarea
                value={form.system_prompt}
                onChange={e => set('system_prompt', e.target.value)}
                placeholder="You are a research analyst. You search the web for information..."
                style={{ minHeight: 140 }}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Model</label>
                <select value={form.model} onChange={e => set('model', e.target.value)}>
                  {MODELS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Max Iterations</label>
                <input type="number" min={1} max={50} value={form.max_iterations} onChange={e => set('max_iterations', +e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Temperature ({form.temperature})</label>
                <input type="range" min={0} max={2} step={0.1} value={form.temperature}
                  onChange={e => set('temperature', +e.target.value)}
                  style={{ padding: 0, background: 'transparent', border: 'none', height: 20 }} />
              </div>
              <div className="form-group">
                <label>Max Tokens</label>
                <input type="number" min={256} max={8192} step={256} value={form.max_tokens} onChange={e => set('max_tokens', +e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* Tools */}
        {tab === 'tools' && (
          <div className="animate-in">
            <p className="text-muted text-sm" style={{ marginBottom: 16 }}>Select tools this agent can use during execution.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tools.map(t => (
                <label key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  padding: '10px 12px', background: form.tools.includes(t.name) ? 'var(--accent)10' : 'var(--surface2)',
                  border: `1px solid ${form.tools.includes(t.name) ? 'var(--accent)40' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)', textTransform: 'none', letterSpacing: 0, marginBottom: 0 }}>
                  <input type="checkbox" checked={form.tools.includes(t.name)} onChange={() => toggleTool(t.name)}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }} />
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>{t.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Memory */}
        {tab === 'memory' && (
          <div className="animate-in">
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={form.memory_enabled} onChange={e => set('memory_enabled', e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>Enable conversation memory</span>
              </label>
            </div>
            {form.memory_enabled && (
              <div className="form-group">
                <label>Memory Window (messages)</label>
                <input type="number" min={4} max={100} value={form.memory_window}
                  onChange={e => set('memory_window', +e.target.value)} />
                <span className="text-xs text-muted">How many past messages to include in each request.</span>
              </div>
            )}
            <div className="panel" style={{ marginTop: 12, fontSize: 12, color: 'var(--text2)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>About Memory</div>
              Memory is stored per agent + session in SQLite. Each time the agent runs, the last N messages
              are loaded and prepended to the conversation. Memory persists across platform restarts.
            </div>
          </div>
        )}

        {/* Guardrails */}
        {tab === 'guardrails' && (
          <div className="animate-in">
            <div className="form-group">
              <label>Forbidden Topics (comma-separated)</label>
              <input
                value={(form.guardrails?.forbidden_topics || []).join(', ')}
                onChange={e => set('guardrails', {
                  ...form.guardrails,
                  forbidden_topics: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                })}
                placeholder="e.g. politics, violence, competitor products"
              />
              <span className="text-xs text-muted">Agent will be instructed to avoid these topics.</span>
            </div>
            <div className="form-group">
              <label>Max Response Length (chars, 0 = unlimited)</label>
              <input type="number" min={0}
                value={form.guardrails?.max_response_length || 0}
                onChange={e => set('guardrails', { ...form.guardrails, max_response_length: +e.target.value || null })}
              />
            </div>
          </div>
        )}

        {/* Schedule */}
        {tab === 'schedule' && (
          <div className="animate-in">
            <div className="form-group">
              <label>Cron Expression</label>
              <input value={form.schedule || ''} onChange={e => set('schedule', e.target.value)}
                placeholder="e.g. 0 9 * * 1-5 (weekdays at 9am)" style={{ fontFamily: 'var(--mono)' }} />
              <span className="text-xs text-muted">Leave blank to disable scheduling. Uses standard 5-field cron syntax.</span>
            </div>
            {form.schedule && (
              <div className="form-group">
                <label>Scheduled Prompt</label>
                <textarea value={form.schedule_prompt || ''} onChange={e => set('schedule_prompt', e.target.value)}
                  placeholder="What should the agent do when triggered by the schedule?" />
              </div>
            )}
            <div className="panel" style={{ fontSize: 12, color: 'var(--text2)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Examples</div>
              <div style={{ fontFamily: 'var(--mono)', lineHeight: 1.8 }}>
                <div><span style={{ color: 'var(--accent)' }}>0 9 * * *</span> — every day at 9am</div>
                <div><span style={{ color: 'var(--accent)' }}>*/30 * * * *</span> — every 30 minutes</div>
                <div><span style={{ color: 'var(--accent)' }}>0 8 * * 1</span> — every Monday at 8am</div>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !form.name || !form.role || !form.system_prompt}>
            {saving ? <><span className="spinner" />&nbsp;Saving…</> : isEdit ? 'Update Agent' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
