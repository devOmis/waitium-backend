import { PrismaClient, Prisma, VerificationToken } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TOKEN_TYPE } from '../../common/enums/token-type.enum';
import { UserFactory } from './user.factory';

let counter = 0;

function nextId(): number {
  return ++counter;
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

type TokenCreateOverrides = Partial<
  Omit<Prisma.VerificationTokenUncheckedCreateInput, 'userId'> & {
    userId?: string;
  }
>;

export class VerificationTokenFactory {
  private readonly userFactory: UserFactory;

  constructor(private readonly prisma: PrismaClient) {
    this.userFactory = new UserFactory(prisma);
  }

  async build(
    overrides: TokenCreateOverrides = {},
  ): Promise<Prisma.VerificationTokenUncheckedCreateInput> {
    const id = nextId();

    let userId = overrides.userId;
    if (!userId) {
      const user = await this.userFactory.create();
      userId = user.id;
    }

    return {
      userId,
      code: generateCode(),
      token: `token-${id}-${randomUUID()}`,
      type: TOKEN_TYPE.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ...overrides,
    };
  }

  async create(overrides: TokenCreateOverrides = {}): Promise<VerificationToken> {
    const data = await this.build(overrides);
    return this.prisma.verificationToken.create({ data });
  }

  async createMany(
    count: number,
    overrides: TokenCreateOverrides = {},
  ): Promise<VerificationToken[]> {
    const tokens: VerificationToken[] = [];
    for (let i = 0; i < count; i++) {
      tokens.push(await this.create(overrides));
    }
    return tokens;
  }

  async createExpired(overrides: TokenCreateOverrides = {}): Promise<VerificationToken> {
    return this.create({
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      ...overrides,
    });
  }

  async createUsed(overrides: TokenCreateOverrides = {}): Promise<VerificationToken> {
    return this.create({
      usedAt: new Date(),
      ...overrides,
    });
  }

  async createPasswordReset(overrides: TokenCreateOverrides = {}): Promise<VerificationToken> {
    return this.create({
      type: TOKEN_TYPE.PASSWORD_RESET,
      ...overrides,
    });
  }
}
