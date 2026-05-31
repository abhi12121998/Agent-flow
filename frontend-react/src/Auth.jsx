import { useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { api } from './api';

export default function Auth({ onAuth }) {
  const [tab, setTab] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (tab === 'register') {
      if (form.password !== form.confirm) {
        setError('Passwords do not match');
        return;
      }
      if (form.password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
    }

    setLoading(true);
    try {
      const res = tab === 'login'
        ? await api.auth.login(form.username, form.password)
        : await api.auth.register(form.username, form.email, form.password);
      localStorage.setItem('yuno_token', res.access_token);
      onAuth(res.user);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text1)', fontSize: 14, outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  const labelStyle = {
    fontSize: 12, color: 'var(--text3)', marginBottom: 4,
    display: 'block', fontFamily: 'var(--mono)',
  };

  const tabBtn = (id, label) => (
    <button
      type="button"
      onClick={() => { setTab(id); setError(''); }}
      style={{
        flex: 1, padding: '10px 0', border: 'none', borderRadius: 8,
        background: tab === id ? 'var(--accent)15' : 'transparent',
        color: tab === id ? 'var(--accent)' : 'var(--text3)',
        cursor: 'pointer', fontSize: 13, fontWeight: tab === id ? 600 : 400,
        boxShadow: tab === id ? 'inset 0 0 0 1px var(--accent)30' : 'none',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg)',
    }}>
      <div style={{
        width: 380, background: 'var(--surface)', borderRadius: 16,
        border: '1px solid var(--border)', padding: 32,
        boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 24px var(--accent)40',
          }}>
            <LayoutDashboard size={20} style={{ color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 18 }}>Yuno</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>AI Agent Platform</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg)', borderRadius: 10, padding: 4 }}>
          {tabBtn('login', 'Login')}
          {tabBtn('register', 'Register')}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input
              style={inputStyle} value={form.username} onChange={set('username')}
              placeholder="your_username" required autoFocus
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {tab === 'register' && (
            <div>
              <label style={labelStyle}>Email</label>
              <input
                style={inputStyle} type="email" value={form.email} onChange={set('email')}
                placeholder="you@example.com" required
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>Password</label>
            <input
              style={inputStyle} type="password" value={form.password} onChange={set('password')}
              placeholder="••••••••" required
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {tab === 'register' && (
            <div>
              <label style={labelStyle}>Confirm Password</label>
              <input
                style={inputStyle} type="password" value={form.confirm} onChange={set('confirm')}
                placeholder="••••••••" required
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
          )}

          {error && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--error, #ef4444)15',
              border: '1px solid var(--error, #ef4444)40',
              color: 'var(--error, #ef4444)', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '11px 0', borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, marginTop: 4, transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Please wait…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
