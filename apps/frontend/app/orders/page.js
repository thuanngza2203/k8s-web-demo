import OrdersClient from '../../components/OrdersClient';
import { recordPageRender } from '../../lib/metrics';

export const dynamic = 'force-dynamic';

export default function OrdersPage() {
  recordPageRender('/orders');
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

  return (
    <>
      <section className="pageHeader">
        <span className="eyebrow">Order History</span>
        <h1>Orders</h1>
        <p className="lede">
          Track your purchases. Each order generates database queries and business metrics
          visible in Grafana dashboards.
        </p>
      </section>

      <OrdersClient apiBaseUrl={apiBaseUrl} />
    </>
  );
}
