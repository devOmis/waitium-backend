import { PrismaClient, Prisma, User } from '@prisma/client';

let counter = 0;

function nextId(): number {
  return ++counter;
}

export class UserFactory {
  constructor(private readonly prisma: PrismaClient) {}

  build(overrides: Partial<Prisma.UserCreateInput> = {}): Prisma.UserCreateInput {
    const id = nextId();
    return {
      name: `Test User ${id}`,
      email: `user-${id}-${Date.now()}@test.com`,
      password: 'hashed_password_placeholder',
      ...overrides,
    };
  }

  async create(overrides: Partial<Prisma.UserCreateInput> = {}): Promise<User> {
    const data = this.build(overrides);
    return this.prisma.user.create({ data });
  }

  async createMany(
    count: number,
    overrides: Partial<Prisma.UserCreateInput> = {},
  ): Promise<User[]> {
    const users: User[] = [];
    for (let i = 0; i < count; i++) {
      users.push(await this.create(overrides));
    }
    return users;
  }

  async createVerified(overrides: Partial<Prisma.UserCreateInput> = {}): Promise<User> {
    return this.create({
      emailVerified: new Date(),
      ...overrides,
    });
  }

  async createWithoutPassword(overrides: Partial<Prisma.UserCreateInput> = {}): Promise<User> {
    return this.create({
      password: null,
      ...overrides,
    });
  }
}
