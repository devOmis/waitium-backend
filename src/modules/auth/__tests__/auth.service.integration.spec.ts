import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { TOKEN_TYPE } from '../../../common/enums/token-type.enum';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { MailService } from '../../../mail/mail.service';
import { PrismaTestHelper } from '../../../../test/helpers/prisma-test.helper';
import { UserFactory } from '../../../database/factories/user.factory';
import { VerificationTokenFactory } from '../../../database/factories/verification-token.factory';

describe('AuthService (Integration)', () => {
  let service: AuthService;
  let db: PrismaTestHelper;
  let prisma: PrismaClient;
  let userFactory: UserFactory;
  let tokenFactory: VerificationTokenFactory;
  let mailSend: jest.Mock;

  beforeAll(async () => {
    db = PrismaTestHelper.getInstance();
    await db.connect();
    prisma = db.getClient();
    userFactory = new UserFactory(prisma);
    tokenFactory = new VerificationTokenFactory(prisma);
  });

  beforeEach(async () => {
    await db.clean();

    mailSend = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: { send: mailSend } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string) => {
              const map: Record<string, string> = {
                FRONTEND_URL: 'http://localhost:3000',
                JWT_SECRET: 'integration-test-secret',
                JWT_REFRESH_SECRET: 'integration-test-refresh-secret',
              };
              return map[key] ?? def;
            },
            getOrThrow: (key: string) => {
              const map: Record<string, string> = {
                JWT_SECRET: 'integration-test-secret',
                JWT_REFRESH_SECRET: 'integration-test-refresh-secret',
              };
              if (!map[key]) throw new Error(`Missing ${key}`);
              return map[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterAll(async () => {
    await db.disconnect();
  });

  describe('register', () => {
    it('should persist user with hashed password and return tokens', async () => {
      const result = await service.register({
        email: 'new@example.com',
        password: 'StrongPass1',
      });

      const user = await prisma.user.findUnique({
        where: { email: 'new@example.com' },
      });

      expect(user).not.toBeNull();
      expect(user!.password).not.toBe('StrongPass1');
      const isHashed = await bcrypt.compare('StrongPass1', user!.password!);
      expect(isHashed).toBe(true);
      expect(result).not.toHaveProperty('password');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.accessToken.split('.')).toHaveLength(3);
      expect(result.refreshToken.split('.')).toHaveLength(3);
    });

    it('should create a verification token with correct expiry', async () => {
      await service.register({
        email: 'verify@example.com',
        password: 'StrongPass1',
      });

      const user = await prisma.user.findUnique({
        where: { email: 'verify@example.com' },
      });
      const token = await prisma.verificationToken.findFirst({
        where: { userId: user!.id, type: TOKEN_TYPE.EMAIL_VERIFICATION },
      });

      expect(token).not.toBeNull();
      expect(token!.code).toHaveLength(6);
      expect(token!.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(token!.usedAt).toBeNull();
    });

    it('should enforce unique email constraint', async () => {
      await userFactory.create({ email: 'taken@example.com' });

      await expect(
        service.register({ email: 'taken@example.com', password: 'StrongPass1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyEmail', () => {
    it('should set emailVerified timestamp in DB', async () => {
      const user = await userFactory.create({ email: 'unverified@test.com' });
      const vToken = await tokenFactory.create({
        userId: user.id,
        code: '123456',
        type: TOKEN_TYPE.EMAIL_VERIFICATION,
      });

      await service.verifyEmail(user.id, { code: '123456' });

      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated!.emailVerified).not.toBeNull();

      const usedToken = await prisma.verificationToken.findUnique({
        where: { id: vToken.id },
      });
      expect(usedToken!.usedAt).not.toBeNull();
    });

    it('should verify via token link', async () => {
      const user = await userFactory.create({ email: 'link@test.com' });
      const vToken = await tokenFactory.create({ userId: user.id });

      await service.verifyEmail(user.id, { token: vToken.token });

      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated!.emailVerified).not.toBeNull();
    });

    it('should reject expired token', async () => {
      const user = await userFactory.create({ email: 'expired@test.com' });
      await tokenFactory.createExpired({ userId: user.id, code: '111111' });

      await expect(
        service.verifyEmail(user.id, { code: '111111' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendVerification', () => {
    it('should invalidate old tokens and create new one', async () => {
      const user = await userFactory.create({ email: 'resend@test.com' });
      const oldToken = await tokenFactory.create({ userId: user.id });

      await service.resendVerification(user.id);

      const invalidated = await prisma.verificationToken.findUnique({
        where: { id: oldToken.id },
      });
      expect(invalidated!.usedAt).not.toBeNull();

      const newTokens = await prisma.verificationToken.findMany({
        where: { userId: user.id, usedAt: null },
      });
      expect(newTokens).toHaveLength(1);
      expect(mailSend).toHaveBeenCalled();
    });

    it('should reject if already verified', async () => {
      const user = await userFactory.createVerified({ email: 'verified@test.com' });

      await expect(
        service.resendVerification(user.id),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('should return tokens for valid credentials against real hashed password', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'login@test.com',
        password: hashed,
        emailVerified: new Date(),
      });

      const result = await service.login({
        email: 'login@test.com',
        password: 'StrongPass1',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.accessToken).toBe('string');
    });

    it('should reject wrong password', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'wrongpw@test.com',
        password: hashed,
        emailVerified: new Date(),
      });

      await expect(
        service.login({ email: 'wrongpw@test.com', password: 'WrongPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return emailVerified as null for unverified user', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'noverify@test.com',
        password: hashed,
      });

      const result = await service.login({ email: 'noverify@test.com', password: 'StrongPass1' });
      expect(result.emailVerified).toBeNull();
    });
  });

  describe('forgotPassword + resetPassword', () => {
    it('should create password reset token and persist new hashed password', async () => {
      const hashed = await bcrypt.hash('OldPass1', 12);
      const user = await userFactory.create({
        email: 'reset@test.com',
        password: hashed,
        emailVerified: new Date(),
      });

      await service.forgotPassword({ email: 'reset@test.com' });
      expect(mailSend).toHaveBeenCalled();

      const resetToken = await prisma.verificationToken.findFirst({
        where: { userId: user.id, type: TOKEN_TYPE.PASSWORD_RESET, usedAt: null },
      });
      expect(resetToken).not.toBeNull();

      await service.resetPassword({
        email: 'reset@test.com',
        code: resetToken!.code,
        newPassword: 'NewStrongPass1',
      });

      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      const newPasswordValid = await bcrypt.compare('NewStrongPass1', updatedUser!.password!);
      expect(newPasswordValid).toBe(true);

      const usedToken = await prisma.verificationToken.findUnique({
        where: { id: resetToken!.id },
      });
      expect(usedToken!.usedAt).not.toBeNull();
    });

    it('should not leak user existence on forgotPassword', async () => {
      const result = await service.forgotPassword({ email: 'nonexistent@test.com' });

      expect(result).toEqual(expect.objectContaining({ message: expect.any(String) }));
      expect(mailSend).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens for valid refresh token', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'refresh@test.com',
        password: hashed,
        emailVerified: new Date(),
      });

      const loginResult = await service.login({
        email: 'refresh@test.com',
        password: 'StrongPass1',
      });

      const refreshResult = await service.refreshToken({
        refreshToken: loginResult.refreshToken,
      });

      expect(refreshResult.accessToken).toBeDefined();
      expect(refreshResult.refreshToken).toBeDefined();
      expect(typeof refreshResult.accessToken).toBe('string');
      expect(typeof refreshResult.refreshToken).toBe('string');
      expect(refreshResult.accessToken.split('.')).toHaveLength(3);
      expect(refreshResult.refreshToken.split('.')).toHaveLength(3);
    });

    it('should reject invalid refresh token', async () => {
      await expect(
        service.refreshToken({ refreshToken: 'garbage-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
