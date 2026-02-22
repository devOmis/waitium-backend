import { readFileSync } from 'fs';

const DB_URL_FILE = '/tmp/.test-db-url';

try {
  const url = readFileSync(DB_URL_FILE, 'utf-8').trim();
  process.env.DATABASE_URL = url;
} catch {
  // In --runInBand mode, globalSetup runs in the same process and
  // DATABASE_URL is already set. Safe to ignore.
}
