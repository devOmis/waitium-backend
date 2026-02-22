import { PrismaClient, Prisma, Account } from '@prisma/client';
import { UserFactory } from './user.factory';

let counter = 0;

function nextId(): number {
  return ++counter;
}

type AccountCreateOverrides = Partial<
  Omit<Prisma.AccountUncheckedCreateInput, 'userId'> & {
    userId?: string;
  }
>;

export class AccountFactory {
  private readonly userFactory: UserFactory;

  constructor(private readonly prisma: PrismaClient) {
    this.userFactory = new UserFactory(prisma);
  }

  async build(
    overrides: AccountCreateOverrides = {},
  ): Promise<Prisma.AccountUncheckedCreateInput> {
    const id = nextId();

    let userId = overrides.userId;
    if (!userId) {
      const user = await this.userFactory.create();
      userId = user.id;
    }

    return {
      userId,
      type: 'oauth',
      provider: `provider-${id}`,
      providerAccountId: `provider-account-${id}-${Date.now()}`,
      ...overrides,
    };
  }

  async create(overrides: AccountCreateOverrides = {}): Promise<Account> {
    const data = await this.build(overrides);
    return this.prisma.account.create({ data });
  }

  async createMany(
    count: number,
    overrides: AccountCreateOverrides = {},
  ): Promise<Account[]> {
    const accounts: Account[] = [];
    for (let i = 0; i < count; i++) {
      accounts.push(await this.create(overrides));
    }
    return accounts;
  }

  async createGoogleAccount(overrides: AccountCreateOverrides = {}): Promise<Account> {
    return this.create({
      type: 'oauth',
      provider: 'google',
      scope: 'openid email profile',
      token_type: 'Bearer',
      ...overrides,
    });
  }

  async createGithubAccount(overrides: AccountCreateOverrides = {}): Promise<Account> {
    return this.create({
      type: 'oauth',
      provider: 'github',
      scope: 'read:user user:email',
      token_type: 'Bearer',
      ...overrides,
    });
  }
}
