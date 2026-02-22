import { PrismaClient, Prisma, Authenticator } from '@prisma/client';
import { randomUUID } from 'crypto';
import { UserFactory } from './user.factory';

let counter = 0;

function nextId(): number {
  return ++counter;
}

type AuthenticatorCreateOverrides = Partial<
  Omit<Prisma.AuthenticatorUncheckedCreateInput, 'userId'> & {
    userId?: string;
  }
>;

export class AuthenticatorFactory {
  private readonly userFactory: UserFactory;

  constructor(private readonly prisma: PrismaClient) {
    this.userFactory = new UserFactory(prisma);
  }

  async build(
    overrides: AuthenticatorCreateOverrides = {},
  ): Promise<Prisma.AuthenticatorUncheckedCreateInput> {
    const id = nextId();

    let userId = overrides.userId;
    if (!userId) {
      const user = await this.userFactory.create();
      userId = user.id;
    }

    return {
      credentialID: `cred-${id}-${Date.now()}`,
      userId,
      providerAccountId: `provider-account-${id}-${Date.now()}`,
      credentialPublicKey: randomUUID(),
      counter: 0,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      ...overrides,
    };
  }

  async create(overrides: AuthenticatorCreateOverrides = {}): Promise<Authenticator> {
    const data = await this.build(overrides);
    return this.prisma.authenticator.create({ data });
  }

  async createMany(
    count: number,
    overrides: AuthenticatorCreateOverrides = {},
  ): Promise<Authenticator[]> {
    const authenticators: Authenticator[] = [];
    for (let i = 0; i < count; i++) {
      authenticators.push(await this.create(overrides));
    }
    return authenticators;
  }

  async createMultiDevice(overrides: AuthenticatorCreateOverrides = {}): Promise<Authenticator> {
    return this.create({
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
      ...overrides,
    });
  }
}
