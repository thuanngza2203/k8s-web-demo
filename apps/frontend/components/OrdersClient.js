'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import LoginModal from './LoginModal';

export default function OrdersClient({ apiBaseUrl }) {
  const { user, token, loading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (loading) {
      return undefined;
    }

    if (!user || !token) {
      setOrders([]);
      setError('');
      setIsLoadingOrders(false);
      return undefined;
    }

    const controller = new AbortController();

    async function loadOrders() {
      setIsLoadingOrders(true);
      setError('');

      try {
        const response = await fetch(`${apiBaseUrl}/api/orders`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error?.message || `API request failed: ${response.status}`);
        }

        setOrders(payload.data || []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingOrders(false);
        }
      }
    }

    loadOrders();
    return () => controller.abort();
  }, [apiBaseUrl, loading, token, user]);

  if (loading || isLoadingOrders) {
    return (
      <section className="panel">
        <div className="emptyState">
          <h2>Loading orders</h2>
          <p className="lede">Fetching your order history.</p>
        </div>
      </section>
    );
  }

  if (!user || !token) {
    return (
      <>
        <section className="panel">
          <div className="emptyState">
            <h2>Sign in to view orders</h2>
            <p className="lede">Order history is private to each account.</p>
            <button className="button primary" type="button" onClick={() => setShowLogin(true)}>
              Sign In
            </button>
          </div>
        </section>
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </>
    );
  }

  if (error) {
    return <p className="error">Could not load orders: {error}</p>;
  }

  return (
    <section className="panel">
      {orders.length === 0 ? (
        <div className="emptyState">
          <h2>No orders yet</h2>
          <p className="lede">Add products to your cart and checkout to create an order.</p>
          <Link className="button primary" href="/">Browse Products</Link>
        </div>
      ) : (
        orders.map((order) => (
          <article className="orderRow" key={order.uuid}>
            <div>
              <span className={`status ${order.status}`}>{order.status}</span>
            </div>
            <div>
              <h3 style={{ marginBottom: 4 }}>
                {order.customer_name || order.customer || 'Customer'}
              </h3>
              <p className="orderMeta">
                {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                {' - '}
                {new Date(order.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              {order.items.length > 0 && (
                <p className="orderMeta" style={{ marginTop: 4 }}>
                  {order.items.map((item) => `${item.name || 'Product'} x${item.quantity}`).join(', ')}
                </p>
              )}
            </div>
            <span className="orderPrice">${Number(order.total_price).toFixed(2)}</span>
          </article>
        ))
      )}
    </section>
  );
}
