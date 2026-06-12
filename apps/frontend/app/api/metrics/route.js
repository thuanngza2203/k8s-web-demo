import { metrics } from '../../../lib/metrics';

export const runtime = 'nodejs';

export async function GET() {
  return new Response(await metrics.registry.metrics(), {
    headers: {
      'Content-Type': metrics.registry.contentType,
    },
  });
}
