'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';

function readCart() {
  if (typeof window === 'undefined') return [];
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

export default function ProductGrid({ products }) {
  const [cart, setCart] = useState([]);
  const [toast, setToast] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setCart(readCart());
    const onUpdate = () => setCart(readCart());
    window.addEventListener('cloud-web-cart-updated', onUpdate);
    return () => window.removeEventListener('cloud-web-cart-updated', onUpdate);
  }, []);

  const addToCart = useCallback((product) => {
    const nextCart = [...readCart()];
    const existing = nextCart.find((item) => item.uuid === product.uuid);

    if (existing) {
      existing.quantity += 1;
    } else {
      nextCart.push({ ...product, quantity: 1 });
    }

    setCart(nextCart);
    writeCart(nextCart);
    setToast(`${product.name} added to cart`);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const categories = ['all', ...new Set(products.map((p) => p.category))];

  const filtered = products.filter((product) => {
    const matchCategory = activeCategory === 'all' || product.category === activeCategory;
    const matchSearch = !search || product.name.toLowerCase().includes(search.toLowerCase())
      || (product.description && product.description.toLowerCase().includes(search.toLowerCase()));
    return matchCategory && matchSearch;
  });

  return (
    <>
      <div className="searchBar">
        <span className="searchIcon">🔍</span>
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          id="product-search"
        />
      </div>

      <div className="categoryFilter">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`catPill ${activeCategory === cat ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveCategory(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      <section className="productGrid">
        {filtered.map((product) => {
          const inCart = cart.find((item) => item.uuid === product.uuid);
          const stockLow = Number(product.stock) < 50;

          return (
            <article className="productCard" key={product.uuid}>
              <div className="productImageWrap">
                <img
                  className="productImage"
                  src={product.image_url}
                  alt={product.name}
                  loading="lazy"
                />
                <span className="productCategoryTag">{product.category}</span>
              </div>
              <div className="productBody">
                <h3>{product.name}</h3>
                <p className="productDesc">{product.description}</p>
                <div className="productMeta">
                  <span className="price">${Number(product.price).toFixed(2)}</span>
                  <span className={`stockBadge ${stockLow ? 'low' : ''}`}>
                    {stockLow ? `Only ${product.stock} left` : `${product.stock} in stock`}
                  </span>
                </div>
                <div className="productActions">
                  <button
                    className="button primary sm"
                    type="button"
                    onClick={() => addToCart(product)}
                    id={`add-to-cart-${product.uuid}`}
                    style={{ flex: 1 }}
                  >
                    {inCart ? `🛒 In Cart (${inCart.quantity})` : '🛒 Add to Cart'}
                  </button>
                  <Link className="button secondary sm" href={`/products/${product.uuid}`}>
                    View
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {filtered.length === 0 && (
        <div className="emptyState">
          <div className="emptyIcon">🔍</div>
          <h2>No products found</h2>
          <p className="lede">Try adjusting your search or category filter.</p>
        </div>
      )}

      {toast && <div className="toast">✓ {toast}</div>}
    </>
  );
}
