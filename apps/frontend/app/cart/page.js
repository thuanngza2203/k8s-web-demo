import CartClient from '../../components/CartClient';
import { publicApiBaseUrl } from '../../lib/api';
import { recordPageRender } from '../../lib/metrics';

export const dynamic = 'force-dynamic';

export default function CartPage() {
  recordPageRender('/cart');

  return (
    <>
      <section className="pageHeader">
        <span className="eyebrow">Shopping Cart</span>
        <h1>Your Cart</h1>
        <p className="lede">
          Review your items and proceed to checkout. Sign in to complete your purchase.
        </p>
      </section>
      <CartClient apiBaseUrl={publicApiBaseUrl()} />
    </>
  );
}
