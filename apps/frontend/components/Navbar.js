'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import LoginModal from './LoginModal';

function readCart() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem('cloud-web-cart') || '[]');
  } catch {
    return [];
  }
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const [cartCount, setCartCount] = useState(0);
  const [showLogin, setShowLogin] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    function updateCount() {
      const cart = readCart();
      setCartCount(cart.reduce((sum, item) => sum + item.quantity, 0));
    }
    updateCount();
    window.addEventListener('cloud-web-cart-updated', updateCount);
    return () => window.removeEventListener('cloud-web-cart-updated', updateCount);
  }, []);

  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brandMark">CW</span>
          <span>Cloud Web Store</span>
        </Link>

        <nav className="nav">
          <Link href="/">Products</Link>
          <Link href="/cart">Cart</Link>
          <Link href="/orders">Orders</Link>
        </nav>

        <div className="navRight">
          <Link href="/cart" className="cartBadge">
            🛒 Cart
            {cartCount > 0 && <span className="cartCount">{cartCount}</span>}
          </Link>

          {user ? (
            <div style={{ position: 'relative' }}>
              <button
                className="userBtn"
                type="button"
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <img
                  className="userAvatar"
                  src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
                  alt={user.username}
                />
                {user.username}
              </button>

              {showUserMenu && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 6,
                    padding: '8px',
                    borderRadius: 12,
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-lg)',
                    minWidth: 180,
                    zIndex: 50,
                  }}
                >
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                    <div style={{ fontWeight: 600, color: 'var(--white)', fontSize: 14 }}>{user.full_name || user.username}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user.email}</div>
                  </div>
                  <Link
                    href="/orders"
                    className="button ghost full"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => setShowUserMenu(false)}
                  >
                    📦 My Orders
                  </Link>
                  <button
                    className="button ghost full"
                    type="button"
                    style={{ justifyContent: 'flex-start', color: 'var(--red)' }}
                    onClick={() => { logout(); setShowUserMenu(false); }}
                  >
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="button primary sm" type="button" onClick={() => setShowLogin(true)}>
              Sign In
            </button>
          )}
        </div>
      </header>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
