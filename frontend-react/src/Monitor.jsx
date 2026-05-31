import { useState, useEffect, useRef } from 'react';
import { Activity, MessageSquare, Cpu, DollarSign, CheckCircle, XCircle, Clock, Zap, RotateCcw } from 'lucide-react';
import { api, createWS } from './api';

const EVENT_COLORS = {
  workflow_start: '#6c8cff',
  workflow_complete: '#34d399',
  workflow_error: '#f87171',
  node_start: '#a78bfa',
  node_complete: '#34d399',
  agent_start: '#6c8cff',
  agent_end: '#34d399',
  llm_response: '#f59e0b',
  condition_eval: '#f59e0b',
};

const EVENT_ICONS = {
  workflow_start: '▶',
  workflow_complete: '✓',
  workflow_error: '✗',
  node_start: '→',
  node_complete: '●',
  agent_start: '◆',
  agent_end: '◇',
  llm_response: '⚡',
  condition_eval: '⟨⟩',
};

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: '16px 20px', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="text-xs text-muted" style={{ marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 800, color: color || 'var(--text)', lineHeight: 1 }}>
            {value}
          </div>
          {sub && <div className="text-xs text-muted" style={{ marginTop: 6 }}>{sub}</div>}
        </div>
        <div style={{ color: color || 'var(--text3)', opacity: 0.6 }}>{icon}</div>
      </div>
    </div>
  );
}

export default function Monitor({ toast }) {
  const [stats, setStats] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('live');
  const [wsStatus, setWsStatus] = useState('connecting');
  const wsRef = useRef(null);
  const logsEndRef = useRef(null);

  useEffect(() => {
    loadStats();
    loadMessages();
    loadLogs();
    const interval = setInterval(() => { loadStats(); loadMessages(); loadLogs(); }, 10000);

    // WebSocket
    const connect = () => {
      const ws = createWS((event) => {
        setLiveEvents(prev => {
          const next = [{ ...event, _id: Date.now() + Math.random() }, ...prev];
          return next.slice(0, 200);
        });
        // Refresh stats on workflow events
        if (event.type?.startsWith('workflow_')) {
          loadStats();
          loadMessages();
        }
      });
      ws.onopen = () => setWsStatus('connected');
      ws.onclose = () => {
        setWsStatus('disconnected');
        setTimeout(connect, 3000);
      };
      wsRef.current = ws;
    };
    connect();

    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveEvents]);

  async function loadStats() {
    try { setStats(await api.stats()); } catch {}
  }
  async function loadMessages() {
    try { setMessages(await api.messages.list({ limit: 50 })); } catch {}
  }
  async function loadLogs() {
    try { setLogs(await api.logs.list({ limit: 100 })); } catch {}
  }

  const tabs = ['live', 'messages', 'logs'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700 }}>Monitor</h2>
            <p className="text-muted text-sm">Real-time agent activity and system metrics</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`dot dot-${wsStatus === 'connected' ? 'green' : wsStatus === 'connecting' ? 'yellow' : 'red'}`} />
            <span className="text-xs text-muted">{wsStatus}</span>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div style={{ display: 'flex', gap: 12 }}>
            <StatCard icon={<Cpu size={20} />} label="Agents" value={stats.active_agents} sub={`${stats.total_agents} total`} color="var(--accent)" />
            <StatCard icon={<Activity size={20} />} label="Runs" value={stats.total_runs} sub={`${stats.completed_runs} completed`} color="var(--accent2)" />
            <StatCard icon={<MessageSquare size={20} />} label="Messages" value={stats.total_messages} sub="across all channels" color="var(--accent3)" />
            <StatCard icon={<Zap size={20} />} label="Tokens" value={stats.total_tokens.toLocaleString()} sub={`$${stats.total_cost_usd?.toFixed(4)} spent`} color="var(--warn)" />
            <StatCard icon={<DollarSign size={20} />} label="Active Bots" value={stats.active_bots} sub="Telegram channels" color="var(--accent3)" />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} className="btn btn-sm"
            style={{ textTransform: 'capitalize', background: activeTab === t ? 'var(--accent)20' : 'transparent',
              color: activeTab === t ? 'var(--accent)' : 'var(--text2)',
              border: activeTab === t ? '1px solid var(--accent)40' : '1px solid transparent' }}>
            {t === 'live' && `⚡ Live Events (${liveEvents.length})`}
            {t === 'messages' && `💬 Messages (${messages.length})`}
            {t === 'logs' && `📋 Logs (${logs.length})`}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => { loadStats(); loadMessages(); loadLogs(); }} style={{ marginLeft: 'auto' }}>
          <RotateCcw size={12} /> Refresh
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {activeTab === 'live' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {liveEvents.length === 0 && (
              <div className="empty-state">
                <Activity size={32} />
                <p>Waiting for events… Run a workflow or send an agent message.</p>
              </div>
            )}
            {liveEvents.map(ev => (
              <div key={ev._id} className="animate-in" style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '8px 12px', background: 'var(--surface2)',
                border: `1px solid ${EVENT_COLORS[ev.type] || 'var(--border)'}20`,
                borderLeft: `3px solid ${EVENT_COLORS[ev.type] || 'var(--border2)'}`,
                borderRadius: 6, fontSize: 12,
              }}>
                <span style={{ color: EVENT_COLORS[ev.type] || 'var(--text2)', fontFamily: 'var(--mono)', width: 16, flexShrink: 0 }}>
                  {EVENT_ICONS[ev.type] || '·'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: EVENT_COLORS[ev.type] || 'var(--text2)' }}>{ev.type}</span>
                    {ev.agent_name && <span className="badge badge-blue" style={{ fontSize: 10, padding: '1px 6px' }}>{ev.agent_name}</span>}
                    {ev.run_id && <span className="text-xs text-muted mono" style={{ fontFamily: 'var(--mono)' }}>{ev.run_id?.slice(0, 8)}</span>}
                  </div>
                  <div style={{ color: 'var(--text)', wordBreak: 'break-word' }}>
                    {ev.input && <span className="text-muted">Input: </span>}
                    {ev.input?.slice(0, 120)}{ev.input?.length > 120 && '…'}
                    {ev.output && <span>{ev.output?.slice(0, 150)}{ev.output?.length > 150 && '…'}</span>}
                    {ev.content && <span>{ev.content?.slice(0, 150)}{ev.content?.length > 150 && '…'}</span>}
                    {ev.error && <span style={{ color: 'var(--danger)' }}>{ev.error}</span>}
                    {ev.condition !== undefined && <span>Condition: <code style={{ fontFamily: 'var(--mono)', color: 'var(--warn)' }}>"{ev.condition}"</code> → {ev.result ? '✓ pass' : '✗ fail'}</span>}
                  </div>
                  {(ev.tokens || ev.cost) && (
                    <div className="text-xs text-muted" style={{ marginTop: 2, fontFamily: 'var(--mono)' }}>
                      {ev.tokens} tok · ${ev.cost?.toFixed(5)}
                    </div>
                  )}
                </div>
                <span className="text-xs text-muted mono" style={{ flexShrink: 0, fontFamily: 'var(--mono)' }}>
                  {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'messages' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && <div className="empty-state"><MessageSquare size={32} /><p>No messages yet.</p></div>}
            {messages.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 12, padding: '10px 14px',
                background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                  background: m.role === 'user' ? 'var(--accent)' : m.channel === 'telegram' ? '#0088cc' : 'var(--accent3)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    {m.agent_name && <span className="badge badge-blue" style={{ fontSize: 10, padding: '1px 6px' }}>{m.agent_name}</span>}
                    <span className="badge" style={{ fontSize: 10, padding: '1px 6px',
                      background: m.channel === 'telegram' ? '#0088cc20' : 'var(--surface3)',
                      color: m.channel === 'telegram' ? '#0088cc' : 'var(--text2)',
                      border: `1px solid ${m.channel === 'telegram' ? '#0088cc40' : 'var(--border2)'}` }}>
                      {m.channel}
                    </span>
                    <span className="text-xs text-muted" style={{ fontFamily: 'var(--mono)' }}>{m.role}</span>
                    {m.metadata?.tokens && <span className="text-xs text-muted mono">{m.metadata.tokens} tok</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-word',
                    display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {m.content}
                  </div>
                </div>
                <span className="text-xs text-muted" style={{ flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 10 }}>
                  {new Date(m.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {logs.length === 0 && <div className="empty-state"><Activity size={32} /><p>No logs yet.</p></div>}
            {logs.map(l => (
              <div key={l.id} style={{ display: 'flex', gap: 10, padding: '6px 10px', borderRadius: 4,
                background: l.level === 'error' ? 'var(--danger)08' : 'transparent',
                borderLeft: `2px solid ${l.level === 'error' ? 'var(--danger)' : l.level === 'warning' ? 'var(--warn)' : 'var(--border2)'}` }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', flexShrink: 0, paddingTop: 1 }}>
                  {new Date(l.created_at).toLocaleTimeString()}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: l.level === 'error' ? 'var(--danger)' : 'var(--text3)', flexShrink: 0, width: 40 }}>
                  [{l.level}]
                </span>
                {l.agent_name && <span className="text-xs" style={{ color: 'var(--accent)', flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 10 }}>{l.agent_name}</span>}
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{l.event}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
