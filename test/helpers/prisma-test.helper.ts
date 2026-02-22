import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export class PrismaTestHelper {
  private static instance: PrismaTestHelper;
  private readonly prisma: PrismaClient;
  private readonly pool: Pool;

  private constructor() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(this.pool);
    this.prisma = new PrismaClient({ adapter });
  }

  static getInstance(): PrismaTestHelper {
    if (!PrismaTestHelper.instance) {
      PrismaTestHelper.instance = new PrismaTestHelper();
    }
    return PrismaTestHelper.instance;
  }

  getClient(): PrismaClient {
    return this.prisma;
  }

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
    await this.pool.end();
  }

  async clean(): Promise<void> {
    const tables = await this.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename != '_prisma_migrations'
    `;

    if (tables.length === 0) return;

    await this.prisma.$executeRawUnsafe(
      `SET session_replication_role = replica`,
    );

    for (const { tablename } of tables) {
      await this.prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "public"."${tablename}" RESTART IDENTITY CASCADE`,
      );
    }

    await this.prisma.$executeRawUnsafe(
      `SET session_replication_role = DEFAULT`,
    );
  }
}
