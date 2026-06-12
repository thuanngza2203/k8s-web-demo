'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import LoginModal from './LoginModal';

function readCart() {
  try {
    return JSON.parse(localStorage.getItem('cloud-web-cart') || '[]');
  } catch {
    return [];
  }
}

function writeCart(cart) {
  localStorage.setItem('cloud-web-cart', JSON.stringify(cart));
  window.dispatchEvent(new Event('cloud-web-cart-updated'));
}

export default function CartClient({ apiBaseUrl }) {
  const { user, token } = useAuth();
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    setCart(readCart());
  }, []);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    [cart]
  );

  const itemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  function updateQuantity(uuid, delta) {
    const nextCart = cart
      .map((item) => (
        item.uuid === uuid ? { ...item, quantity: Math.max(item.quantity + delta, 1) } : item
      ))
      .filter((item) => item.quantity > 0);

    setCart(nextCart);
    writeCart(nextCart);
  }

  function removeItem(uuid) {
    const nextCart = cart.filter((item) => item.uuid !== uuid);
    setCart(nextCart);
    writeCart(nextCart);
  }

  async function checkout() {
    setMessage('');
    setError('');

    if (!user || !token) {
      setShowLogin(true);
      return;
    }

    setIsCheckingOut(true);

    try {
      const orderResponse = await fetch(`${apiBaseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: cart.map((item) => ({
            product_uuid: item.uuid,
            quantity: item.quantity,
          })),
        }),
      });

      const orderPayload = await orderResponse.json();
      if (!orderResponse.ok) {
        throw new Error(orderPayload.error?.message || 'Checkout failed');
      }

      setCart([]);
      writeCart([]);
      setMessage(`Order ${orderPayload.data.uuid.slice(0, 8)}... created! Total: $${Number(orderPayload.data.total_price).toFixed(2)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCheckingOut(false);
    }
  }

  if (cart.length === 0) {
    return (
      <>
        <div className="emptyState">
          {message ? (
            <p className="success" style={{ marginBottom: 20, textAlign: 'left', maxWidth: 480, margin: '0 auto 20px' }}>✓ {message}</p>
          ) : null}
          <div className="emptyIcon">🛒</div>
          <h2>Your cart is empty</h2>
          <p className="lede">Looks like you haven&apos;t added anything yet.</p>
          <Link className="button primary" href="/">Browse Products</Link>
        </div>
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </>
    );
  }

  return (
    <>
      <section className="cartLayout">
        <div className="panel">
          {cart.map((item) => (
            <article className="cartItem" key={item.uuid}>
              <img className="cartThumb" src={item.image_url} alt={item.name} />
              <div className="cartItemInfo">
                <h3>{item.name}</h3>
                <span className="cartItemPrice">${Number(item.price).toFixed(2)}</span>
                <button
                  className="button danger sm"
                  type="button"
                  onClick={() => removeItem(item.uuid)}
                  style={{ marginTop: 8 }}
                >
                  Remove
                </button>
              </div>
              <div className="qtyControls" aria-label={`Quantity for ${item.name}`}>
                <button type="button" onClick={() => updateQuantity(item.uuid, -1)}>−</button>
                <strong>{item.quantity}</strong>
                <button type="button" onClick={() => updateQuantity(item.uuid, 1)}>+</button>
              </div>
            </article>
          ))}
        </div>

        <aside className="panel summary">
          <h2>Order Summary</h2>
          <div className="divider" />
          <div className="summaryLine">
            <span>Items</span>
            <strong>{itemCount}</strong>
          </div>
          <div className="summaryLine">
            <span>Subtotal</span>
            <strong>${subtotal.toFixed(2)}</strong>
          </div>
          <div className="summaryLine">
            <span>Shipping</span>
            <strong style={{ color: 'var(--green)' }}>Free</strong>
          </div>
          <div className="summaryTotal">
            <span>Total</span>
            <strong>${subtotal.toFixed(2)}</strong>
          </div>

          {message && <p className="success">✓ {message}</p>}
          {error && <p className="error">{error}</p>}

          {!user && (
            <p className="notice" style={{ fontSize: 13 }}>
              Please sign in to complete your order.
            </p>
          )}

          <button
            className="button primary full"
            type="button"
            onClick={checkout}
            disabled={isCheckingOut}
            id="checkout-btn"
          >
            {isCheckingOut ? 'Processing...' : user ? `Pay $${subtotal.toFixed(2)}` : 'Sign In to Checkout'}
          </button>
        </aside>
      </section>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
