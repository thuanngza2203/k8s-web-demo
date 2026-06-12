'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';

export default function LoginModal({ onClose }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, email, password, fullName);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modalContent">
        <div className="loginCard">
          <h1>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
          <p className="lede">
            {mode === 'login'
              ? 'Sign in to your account to continue shopping.'
              : 'Join Cloud Web Store to start shopping.'}
          </p>

          <div className="demoCredentials">
            <strong>Demo accounts:</strong> alice / bob / charlie / diana<br />
            <strong>Password:</strong> <code>password123</code>
          </div>

          {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

          <form onSubmit={handleSubmit}>
            <div className="formGroup">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                required
                autoFocus
              />
            </div>

            {mode === 'register' && (
              <>
                <div className="formGroup">
                  <label>Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                  />
                </div>
                <div className="formGroup">
                  <label>Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                  />
                </div>
              </>
            )}

            <div className="formGroup">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                minLength={6}
              />
            </div>

            <button className="button primary full" type="submit" disabled={loading}>
              {loading
                ? (mode === 'login' ? 'Signing in...' : 'Creating account...')
                : (mode === 'login' ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          <div className="formFooter">
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button type="button" onClick={() => { setMode('register'); setError(''); }}>
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => { setMode('login'); setError(''); }}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
