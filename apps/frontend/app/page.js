import ProductGrid from '../components/ProductGrid';
import { fetchProducts, publicApiBaseUrl } from '../lib/api';
import { recordPageRender } from '../lib/metrics';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  recordPageRender('/');

  let products = [];
  let error = null;

  try {
    products = await fetchProducts();
  } catch (err) {
    error = err.message;
  }

  const totalStock = products.reduce((sum, p) => sum + Number(p.stock || 0), 0);
  const categories = new Set(products.map((p) => p.category)).size;
  const avgPrice = products.length > 0
    ? (products.reduce((sum, p) => sum + Number(p.price), 0) / products.length).toFixed(2)
    : '0.00';

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="heroGlow" />
        <span className="eyebrow">Kubernetes E-commerce Demo</span>
        <h1>Cloud Web Store</h1>
        <p className="lede">
          A full-featured online store generating real metrics for Prometheus and
          Grafana. Browse products, login, add to cart, and checkout.
        </p>
        <div className="heroCta">
          <Link href="#products" className="button primary">
            Browse Products
          </Link>
          <Link href="/orders" className="button secondary">
            View Orders
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="metricsStrip" aria-label="Store summary">
        <div className="metricTile">
          <strong>{products.length}</strong>
          <span>Products</span>
        </div>
        <div className="metricTile">
          <strong>{categories}</strong>
          <span>Categories</span>
        </div>
        <div className="metricTile">
          <strong>{totalStock.toLocaleString()}</strong>
          <span>Units in Stock</span>
        </div>
        <div className="metricTile">
          <strong>${avgPrice}</strong>
          <span>Avg. Price</span>
        </div>
      </section>

      {/* Products */}
      <div id="products">
        <div className="sectionTitle">
          <h2>All Products</h2>
        </div>

        {error ? (
          <p className="error">API unavailable: {error}</p>
        ) : (
          <ProductGrid products={products} apiBaseUrl={publicApiBaseUrl()} />
        )}
      </div>
    </>
  );
}
