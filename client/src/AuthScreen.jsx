import { useState } from 'react';
import { api } from './api.js';
import { ShieldCheck, Video, Mail, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function AuthScreen({ onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!email || !name || !password) {
      setError('Please fill in your name, email, and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const data = await api.sendOtp(email.trim());
      setOtpSent(true);
      if (data.devOtp) {
        setDevOtpHint(data.devOtp);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpRegister = async (e) => {
    e.preventDefault();
    if (!otp || otp.trim().length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const data = await api.verifyOtpRegister(
        email.trim(),
        otp.trim(),
        password,
        name.trim(),
        username.trim()
      );
      onAuthSuccess(data.token, data.user, data.refreshToken);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.login(email.trim(), password);
      onAuthSuccess(data.token, data.user, data.refreshToken);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchTab = (loginMode) => {
    setIsLogin(loginMode);
    setError('');
    setOtpSent(false);
    setOtp('');
    setDevOtpHint('');
  };

  return (
    <div className="auth-container">
      <div className="glass-card auth-box">
        <div className="auth-header">
          <div style={{ display: 'inline-flex', padding: '12px', background: 'rgba(99, 102, 241, 0.15)', borderRadius: '12px', marginBottom: '12px' }}>
            <Video size={32} color="#818cf8" />
          </div>
          <h1>OmniCall SFU</h1>
          <p>Secure multi-party WebRTC platform with OTP email verification</p>
        </div>

        <div className="tab-group">
          <button
            type="button"
            className={`tab-btn ${isLogin ? 'active' : ''}`}
            onClick={() => handleSwitchTab(true)}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`tab-btn ${!isLogin ? 'active' : ''}`}
            onClick={() => handleSwitchTab(false)}
          >
            Create Account
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* ─── Sign In Form ─── */}
        {isLogin ? (
          <form onSubmit={handleLoginSubmit}>
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
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', marginTop: '8px' }}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        ) : !otpSent ? (
          /* ─── Sign Up Step 1: User Details & Send OTP ─── */
          <form onSubmit={handleSendOtp}>
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Alice Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

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
              <label>Username (Optional)</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. alicesmith"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                className="form-control"
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Mail size={16} /> {loading ? 'Sending Code...' : 'Send Verification OTP'}
            </button>
          </form>
        ) : (
          /* ─── Sign Up Step 2: 6-Digit OTP Verification ─── */
          <form onSubmit={handleVerifyOtpRegister}>
            <div style={{ background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '10px', padding: '12px', marginBottom: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#a5b4fc', marginBottom: '4px', fontWeight: 600 }}>
                Verification Code Sent!
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                We sent a 6-digit code to <strong style={{ color: '#fff' }}>{email}</strong>
              </div>
              {devOtpHint && (
                <div style={{ marginTop: '8px', padding: '4px 8px', background: 'rgba(16,185,129,0.2)', color: '#34d399', fontSize: '0.75rem', borderRadius: '6px' }}>
                  🔑 Preview Code: <strong>{devOtpHint}</strong>
                </div>
              )}
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>6-Digit Verification Code</span>
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  style={{ background: 'transparent', color: '#818cf8', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                >
                  <ArrowLeft size={12} /> Edit Details
                </button>
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                style={{ fontSize: '1.4rem', letterSpacing: '8px', textAlign: 'center', fontWeight: 700 }}
                autoFocus
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <KeyRound size={16} /> {loading ? 'Verifying & Registering...' : 'Verify OTP & Create Account'}
            </button>
          </form>
        )}

        <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <ShieldCheck size={14} color="#10b981" /> 6-digit OTP verification & enterprise token encryption
        </div>
      </div>
    </div>
  );
}
