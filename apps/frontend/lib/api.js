import { metrics } from './metrics';

const API_BASE_URL = process.env.API_INTERNAL_URL
  || process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:8081';

async function apiFetch(path, options = {}, target = path) {
  const method = options.method || 'GET';
  const endTimer = metrics.apiRequestDuration.startTimer({ method, target });
  let statusCode = '0';

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    statusCode = String(response.status);
    metrics.apiRequestsTotal.inc({ method, target, status_code: statusCode });
    endTimer({ status_code: statusCode });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
  } catch (err) {
    if (statusCode === '0') {
      metrics.apiRequestsTotal.inc({ method, target, status_code: 'network_error' });
      endTimer({ status_code: 'network_error' });
    }
    throw err;
  }
}

export async function fetchProducts() {
  const payload = await apiFetch('/api/products', {}, 'products');
  return payload.data || [];
}

export async function fetchProduct(uuid) {
  const payload = await apiFetch(`/api/products/${uuid}`, {}, 'product_detail');
  return payload.data;
}

export async function fetchOrders() {
  const payload = await apiFetch('/api/orders', {}, 'orders');
  return payload.data || [];
}

export async function fetchCategories() {
  const payload = await apiFetch('/api/products/categories', {}, 'categories');
  return payload.data || [];
}

export function publicApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
}
