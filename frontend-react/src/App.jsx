import { useState, useEffect } from 'react';
import { Bot, GitBranch, Activity, Radio, LayoutDashboard, LogOut } from 'lucide-react';
import AgentStudio from './AgentStudio';
import WorkflowBuilder from './WorkflowBuilder';
import Monitor from './Monitor';
import Channels from './Channels';
import Auth from './Auth';
import { useToast, ToastContainer } from './toast';
import { api } from './api';
import './index.css';

const NAV = [
  { id: 'agents',    label: 'Agent Studio',  icon: Bot,       desc: 'Create & chat with agents' },
  { id: 'workflows', label: 'Workflows',      icon: GitBranch, desc: 'Visual workflow builder' },
  { id: 'monitor',   label: 'Monitor',        icon: Activity,  desc: 'Live logs & metrics' },
  { id: 'channels',  label: 'Channels',       icon: Radio,     desc: 'Telegram & messaging' },
];

export default function App() {
  const [page, setPage] = useState('agents');
  const [provider, setProvider] = useState(null);
  const [user, setUser] = useState(null);       // null = not checked yet
  const [authChecked, setAuthChecked] = useState(false);
  const { toasts, toast } = useToast();

  // On mount: verify token and load user
  useEffect(() => {
    const token = localStorage.getItem('yuno_token');
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api.auth.me()
      .then((u) => { setUser(u); setAuthChecked(true); })
      .catch(() => {
        localStorage.removeItem('yuno_token');
        setAuthChecked(true);
      });
  }, []);

  // Listen for logout events fired by api.js on 401
  useEffect(() => {
    const handler = () => { setUser(null); };
    window.addEventListener('yuno:logout', handler);
    return () => window.removeEventListener('yuno:logout', handler);
  }, []);

  // Load provider info once authenticated
  useEffect(() => {
    if (user) api.provider().then(setProvider).catch(() => {});
  }, [user]);

  function handleLogout() {
    localStorage.removeItem('yuno_token');
    setUser(null);
    setProvider(null);
  }

  // Not yet checked → blank screen (avoids flash)
  if (!authChecked) return null;

  // Not logged in → show auth screen
  if (!user) {
    return (
      <>
        <Auth onAuth={(u) => setUser(u)} />
        <ToastContainer toasts={toasts} />
      </>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px var(--accent)40',
            }}>
              <LayoutDashboard size={16} style={{ color: '#fff' }} />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em' }}>Yuno</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>AI Platform</div>
            </div>
          </div>

        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {NAV.map(item => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button key={item.id} onClick={() => setPage(item.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8, border: 'none',
                background: active ? 'var(--accent)15' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text2)',
                cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.15s',
                boxShadow: active ? 'inset 0 0 0 1px var(--accent)30' : 'none',
              }}>
                <Icon size={16} style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{item.label}</div>
                  <div style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.2 }}>{item.desc}</div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Footer — user info + logout */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8, fontWeight: 500 }}>
            {user.username}
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 10px', borderRadius: 7, border: 'none',
              background: 'transparent', color: 'var(--text3)',
              cursor: 'pointer', fontSize: 12, width: '100%',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--error,#ef4444)15'; e.currentTarget.style.color = 'var(--error,#ef4444)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text3)'; }}
          >
            <LogOut size={13} />
            Sign out
          </button>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 6 }}>
            <div>LangGraph · Groq</div>
            <div>v1.0.0</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {page === 'agents'    && <AgentStudio toast={toast} />}
        {page === 'workflows' && <WorkflowBuilder toast={toast} />}
        {page === 'monitor'   && <Monitor toast={toast} />}
        {page === 'channels'  && <Channels toast={toast} />}
      </div>

      <ToastContainer toasts={toasts} />
    </div>
  );
}
