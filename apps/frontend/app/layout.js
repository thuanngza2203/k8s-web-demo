import './globals.css';
import ClientShell from '../components/ClientShell';

export const metadata = {
  title: 'Cloud Web Store — E-commerce Demo',
  description: 'Premium e-commerce application with Kubernetes monitoring, Prometheus metrics, and Grafana dashboards.',
};

export default function RootLayout({ children }) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

  return (
    <html lang="en">
      <body>
        <ClientShell apiBaseUrl={apiBaseUrl}>
          {children}
        </ClientShell>
      </body>
    </html>
  );
}
