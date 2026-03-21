import { eventBus } from '@/lib/events/emitter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection confirmation
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Listen for donor events
      const unsub = eventBus.on('donor:added', (data) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream closed
        }
      });

      // Note: ReadableStream doesn't have a built-in close callback.
      // The heartbeat will fail when the client disconnects, cleaning up.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
