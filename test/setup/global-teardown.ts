import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalTeardown() {
  console.log('\n🧹 Stopping PostgreSQL testcontainer...');

  const container = (globalThis as Record<string, unknown>)
    .__TESTCONTAINER__ as StartedPostgreSqlContainer | undefined;

  if (container) {
    await container.stop();
    console.log('✅ Container stopped');
  }
}
