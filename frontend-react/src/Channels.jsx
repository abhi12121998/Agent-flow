import { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, MessageCircle, X, ExternalLink } from 'lucide-react';
import { api } from './api';

export default function Channels({ toast }) {
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', channel_type: 'telegram', token: '', agent_id: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [ch, ag] = await Promise.all([api.channels.list(), api.agents.list()]);
      setChannels(ch);
      setAgents(ag);
    } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }

  async function create() {
    if (!form.name || !form.token || !form.agent_id) return;
    setSaving(true);
    try {
      await api.channels.create({
        name: form.name,
        channel_type: form.channel_type,
        config: { token: form.token },
        agent_id: form.agent_id,
      });
      toast('Channel created and bot started!', 'success');
      setShowModal(false);
      setForm({ name: '', channel_type: 'telegram', token: '', agent_id: '' });
      load();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }

  async function deleteChannel(id) {
    if (!confirm('Stop bot and delete this channel?')) return;
    try {
      await api.channels.delete(id);
      toast('Channel deleted', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function restartBot(id) {
    try {
      const res = await api.channels.restart(id);
      toast(res.ok ? 'Bot restarted' : 'Failed to restart bot', res.ok ? 'success' : 'error');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700 }}>Channels</h2>
          <p className="text-muted text-sm">Connect agents to external messaging platforms</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={14} /> Add Channel
        </button>
      </div>

      {/* Setup Guide */}
      <div className="card" style={{ padding: 20, marginBottom: 20, background: 'var(--surface)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🤖</span> Telegram Bot Setup Guide
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
          <div>1. Open Telegram and message <a href="https://t.me/BotFather" target="_blank" style={{ color: 'var(--accent)' }}>@BotFather</a></div>
          <div>2. Send <code style={{ fontFamily: 'var(--mono)', background: 'var(--surface3)', padding: '1px 6px', borderRadius: 3 }}>/newbot</code> and follow the prompts</div>
          <div>3. BotFather gives you a token like <code style={{ fontFamily: 'var(--mono)', background: 'var(--surface3)', padding: '1px 6px', borderRadius: 3 }}>1234567890:ABCdef...</code></div>
          <div>4. Paste the token below, select an agent, and click Add Channel</div>
          <div>5. Find your bot in Telegram by its username and start chatting!</div>
        </div>
      </div>

      {/* Channels List */}
      {channels.length === 0 && (
        <div className="empty-state card" style={{ padding: 60 }}>
          <MessageCircle size={40} />
          <div style={{ fontFamily: 'var(--display)', fontSize: 15, fontWeight: 600, color: 'var(--text2)' }}>No channels yet</div>
          <p>Add a Telegram channel to let users chat with your agent.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {channels.map(ch => {
          const agent = agents.find(a => a.id === ch.agent_id);
          return (
            <div key={ch.id} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#0088cc20',
                display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #0088cc40', flexShrink: 0 }}>
                <span style={{ fontSize: 20 }}>✈️</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{ch.name}</span>
                  <span className={`badge badge-${ch.channel_type === 'telegram' ? 'blue' : 'gray'}`}>
                    {ch.channel_type}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span className={`dot dot-${ch.bot_running ? 'green' : 'red'}`} />
                    <span className="text-xs text-muted">{ch.bot_running ? 'running' : 'stopped'}</span>
                  </span>
                </div>
                <div className="text-xs text-muted">
                  Agent: {agent ? <span style={{ color: 'var(--accent)' }}>{agent.name}</span> : <span style={{ color: 'var(--danger)' }}>Agent not found</span>}
                  &nbsp;·&nbsp;Created {new Date(ch.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => restartBot(ch.id)}>
                  <RefreshCw size={12} /> Restart
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => deleteChannel(ch.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Add Telegram Channel</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}><X size={16} /></button>
            </div>

            <div className="form-group">
              <label>Channel Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Customer Support Bot" />
            </div>

            <div className="form-group">
              <label>Bot Token * <a href="https://t.me/BotFather" target="_blank" style={{ color: 'var(--accent)', fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>(get from @BotFather <ExternalLink size={9} style={{ display: 'inline' }} />)</a></label>
              <input value={form.token} onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ" style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
            </div>

            <div className="form-group">
              <label>Assign Agent *</label>
              <select value={form.agent_id} onChange={e => setForm(f => ({ ...f, agent_id: e.target.value }))}>
                <option value="">— Select Agent —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
              </select>
            </div>

            <div className="panel" style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              The bot will start immediately after creation. Users can find it in Telegram by its username
              and begin chatting with the assigned agent.
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={create}
                disabled={saving || !form.name || !form.token || !form.agent_id}>
                {saving ? <><span className="spinner" /> Starting bot…</> : '✈️ Add & Start Bot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
