import Link from 'next/link';
import { fetchProduct, fetchProducts, publicApiBaseUrl } from '../../../lib/api';
import { recordPageRender } from '../../../lib/metrics';
import ProductGrid from '../../../components/ProductGrid';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }) {
  recordPageRender('/products/:id');
  const { id } = await params;

  let product = null;
  let error = null;
  let relatedProducts = [];

  try {
    product = await fetchProduct(id);
  } catch (err) {
    error = err.message;
  }

  if (product) {
    try {
      const all = await fetchProducts();
      relatedProducts = all
        .filter((p) => p.category === product.category && p.uuid !== product.uuid)
        .slice(0, 3);
    } catch {
      // ignore
    }
  }

  if (error || !product) {
    return (
      <section className="pageHeader">
        <span className="eyebrow">Product Detail</span>
        <h1>Product not available</h1>
        <p className="error">{error || 'Product not found'}</p>
        <Link className="button secondary" href="/" style={{ marginTop: 16 }}>Back to Products</Link>
      </section>
    );
  }

  const stockLow = Number(product.stock) < 50;

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Link className="button ghost" href="/">← Back to Products</Link>
      </div>

      <section className="productDetail">
        <img
          className="productDetailImage"
          src={product.image_url}
          alt={product.name}
        />

        <div className="productDetailInfo">
          <span className="eyebrow">{product.category}</span>
          <h1>{product.name}</h1>
          <span className="productDetailPrice">${Number(product.price).toFixed(2)}</span>
          <p className="productDetailDesc">{product.description}</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`stockBadge ${stockLow ? 'low' : ''}`} style={{ fontSize: 14 }}>
              {stockLow ? `⚠ Only ${product.stock} left` : `✓ ${product.stock} in stock`}
            </span>
          </div>

          <ProductGrid products={[product]} apiBaseUrl={publicApiBaseUrl()} />
        </div>
      </section>

      {relatedProducts.length > 0 && (
        <section style={{ marginTop: 60 }}>
          <div className="sectionTitle">
            <h2>Related Products</h2>
          </div>
          <ProductGrid products={relatedProducts} apiBaseUrl={publicApiBaseUrl()} />
        </section>
      )}
    </>
  );
}
