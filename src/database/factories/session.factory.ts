import { PrismaClient, Prisma, Session } from '@prisma/client';
import { randomUUID } from 'crypto';
import { UserFactory } from './user.factory';

type SessionCreateOverrides = Partial<
  Omit<Prisma.SessionUncheckedCreateInput, 'userId'> & {
    userId?: string;
  }
>;

export class SessionFactory {
  private readonly userFactory: UserFactory;

  constructor(private readonly prisma: PrismaClient) {
    this.userFactory = new UserFactory(prisma);
  }

  async build(
    overrides: SessionCreateOverrides = {},
  ): Promise<Prisma.SessionUncheckedCreateInput> {
    let userId = overrides.userId;
    if (!userId) {
      const user = await this.userFactory.create();
      userId = user.id;
    }

    return {
      sessionToken: randomUUID(),
      userId,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  async create(overrides: SessionCreateOverrides = {}): Promise<Session> {
    const data = await this.build(overrides);
    return this.prisma.session.create({ data });
  }

  async createMany(
    count: number,
    overrides: SessionCreateOverrides = {},
  ): Promise<Session[]> {
    const sessions: Session[] = [];
    for (let i = 0; i < count; i++) {
      sessions.push(await this.create(overrides));
    }
    return sessions;
  }

  async createExpired(overrides: SessionCreateOverrides = {}): Promise<Session> {
    return this.create({
      expires: new Date(Date.now() - 24 * 60 * 60 * 1000),
      ...overrides,
    });
  }
}
