import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const DB_URL_FILE = '/tmp/.test-db-url';

export default async function globalSetup() {
  console.log('\n🐘 Starting PostgreSQL testcontainer...');

  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_password')
    .start();

  const connectionUri = container.getConnectionUri();

  console.log(`✅ Container started: ${connectionUri}`);

  writeFileSync(DB_URL_FILE, connectionUri, 'utf-8');

  console.log('📦 Pushing Prisma schema to test database...');

  execSync(`npx prisma db push --force-reset`, {
    env: { ...process.env, DATABASE_URL: connectionUri },
    stdio: 'pipe',
  });

  console.log('✅ Schema pushed successfully');

  (globalThis as Record<string, unknown>).__TESTCONTAINER__ = container;
}
