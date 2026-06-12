'use client';

import { useState } from 'react';
import { useAuth } from '../../components/AuthProvider';
import LoginModal from '../../components/LoginModal';

export default function LoginPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  if (user) {
    return (
      <div className="loginContainer">
        <div className="loginCard">
          <h1>Welcome, {user.full_name || user.username}!</h1>
          <p className="lede">You are signed in as <strong>{user.username}</strong>.</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
            <a className="button primary" href="/">Browse Products</a>
            <a className="button secondary" href="/orders">My Orders</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="loginContainer">
        <div className="loginCard">
          <h1>Sign In</h1>
          <p className="lede">
            Access your account to shop and track your orders.
          </p>

          <div className="demoCredentials">
            <strong>Demo accounts:</strong> alice / bob / charlie / diana<br />
            <strong>Password:</strong> <code>password123</code>
          </div>

          <button
            className="button primary full"
            type="button"
            onClick={() => setShowModal(true)}
          >
            Continue to Sign In
          </button>

          <div className="formFooter" style={{ marginTop: 16 }}>
            Don&apos;t have an account?{' '}
            <button type="button" onClick={() => setShowModal(true)}>
              Create one
            </button>
          </div>
        </div>
      </div>

      {showModal && <LoginModal onClose={() => setShowModal(false)} />}
    </>
  );
}
