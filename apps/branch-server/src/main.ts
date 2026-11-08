import Fastify from 'fastify';

const fastify = Fastify({
  logger: true,
});

fastify.get('/health', async () => {
  return {
    status: 'ok',
    role: 'branch-coordinator',
    mode: 'local-runtime',
    timestamp: new Date().toISOString(),
  };
});

// Endpoint for POS devices to fetch or renew inventory quota leases locally
fastify.post('/api/v1/quota/lease', async (request, reply) => {
  return reply.status(200).send({
    message: 'Local branch quota coordinator active',
    status: 'READY',
  });
});

async function start() {
  try {
    const port = Number(process.env.BRANCH_PORT) || 8080;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`📡 Restaurant Cloud Branch Server running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
