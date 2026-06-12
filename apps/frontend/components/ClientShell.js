'use client';

import { AuthProvider } from './AuthProvider';
import Navbar from './Navbar';

export default function ClientShell({ children, apiBaseUrl }) {
  return (
    <AuthProvider apiBaseUrl={apiBaseUrl}>
      <Navbar />
      <main>{children}</main>
    </AuthProvider>
  );
}
