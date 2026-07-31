import { useState } from 'react';
import { api } from './api.js';
import { ShieldCheck, Video } from 'lucide-react';

export default function AuthScreen({ onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let data;
      if (isLogin) {
        data = await api.login(email, password);
      } else {
        data = await api.register(email, password, name);
      }
      onAuthSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="glass-card auth-box">
        <div className="auth-header">
          <div style={{ display: 'inline-flex', padding: '12px', background: 'rgba(99, 102, 241, 0.15)', borderRadius: '12px', marginBottom: '12px' }}>
            <Video size={32} color="#818cf8" />
          </div>
          <h1>OmniCall SFU</h1>
          <p>Secure multi-party call platform with authenticated clip injection</p>
        </div>

        <div className="tab-group">
          <button
            type="button"
            className={`tab-btn ${isLogin ? 'active' : ''}`}
            onClick={() => { setIsLogin(true); setError(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`tab-btn ${!isLogin ? 'active' : ''}`}
            onClick={() => { setIsLogin(false); setError(''); }}
          >
            Create Account
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Alice Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required={!isLogin}
              />
            </div>
          )}

          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              className="form-control"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="form-control"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <ShieldCheck size={14} color="#10b981" /> End-to-end token verification & isolated media library
        </div>
      </div>
    </div>
  );
}
