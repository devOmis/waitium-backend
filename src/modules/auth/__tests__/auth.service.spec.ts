import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { MailService } from '../../../mail/mail.service';
import { TOKEN_TYPE } from '../../../common/enums/token-type.enum';

jest.mock('bcrypt');

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

function createMockPrismaService() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    verificationToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      verificationToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    })),
  };
}

function createMockMailService() {
  return {
    send: jest.fn(),
  };
}

function createMockJwtService() {
  return {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };
}

function createMockConfigService() {
  const config: Record<string, string> = {
    FRONTEND_URL: 'http://localhost:3000',
    JWT_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
  };
  return {
    get: jest.fn((key: string, defaultVal?: string) => config[key] ?? defaultVal),
    getOrThrow: jest.fn((key: string) => {
      if (!config[key]) throw new Error(`Missing ${key}`);
      return config[key];
    }),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let mail: ReturnType<typeof createMockMailService>;
  let jwt: ReturnType<typeof createMockJwtService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    mail = createMockMailService();
    jwt = createMockJwtService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const dto = { email: 'test@example.com', password: 'StrongPass1' };

    function setupRegisterMocks() {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-1', email: dto.email, password: 'hashed' });
      prisma.verificationToken.create.mockResolvedValue({ id: 'token-1', code: '123456', token: 'uuid-token' });
      mockBcrypt.hash.mockResolvedValue('hashed' as never);
      mail.send.mockResolvedValue(undefined);
      jwt.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
    }

    it('should hash the password with bcrypt cost 12', async () => {
      setupRegisterMocks();

      await service.register(dto);

      expect(mockBcrypt.hash).toHaveBeenCalledWith(dto.password, 12);
    });

    it('should create user and verification token', async () => {
      setupRegisterMocks();

      await service.register(dto);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: dto.email,
          password: 'hashed',
        }),
      });
      expect(prisma.verificationToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          type: TOKEN_TYPE.EMAIL_VERIFICATION,
        }),
      });
    });

    it('should send verification email', async () => {
      setupRegisterMocks();

      await service.register(dto);

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.email,
          subject: expect.stringContaining('Verify'),
        }),
      );
    });

    it('should return accessToken and refreshToken', async () => {
      setupRegisterMocks();

      const result = await service.register(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.id).toBe('user-1');
      expect(result.email).toBe(dto.email);
    });

    it('should throw ConflictException for duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: dto.email });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('should never return password in response', async () => {
      setupRegisterMocks();

      const result = await service.register(dto);

      expect(result).not.toHaveProperty('password');
    });
  });

  describe('verifyEmail', () => {
    it('should verify with valid 6-digit code', async () => {
      const token = {
        id: 'token-1',
        userId: 'user-1',
        code: '123456',
        token: 'uuid-token',
        type: TOKEN_TYPE.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        usedAt: null,
      };
      prisma.verificationToken.findFirst.mockResolvedValue(token);
      prisma.verificationToken.update.mockResolvedValue({ ...token, usedAt: new Date() });
      prisma.user.update.mockResolvedValue({ id: 'user-1', emailVerified: new Date() });

      const result = await service.verifyEmail('user-1', { code: '123456' });

      expect(result).toEqual(expect.objectContaining({ message: expect.any(String) }));
      expect(prisma.verificationToken.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: 'user-1', code: '123456' }),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should verify with valid token link', async () => {
      const token = {
        id: 'token-1',
        userId: 'user-1',
        code: '123456',
        token: 'uuid-token',
        type: TOKEN_TYPE.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        usedAt: null,
      };
      prisma.verificationToken.findFirst.mockResolvedValue(token);
      prisma.verificationToken.update.mockResolvedValue({ ...token, usedAt: new Date() });
      prisma.user.update.mockResolvedValue({ id: 'user-1', emailVerified: new Date() });

      const result = await service.verifyEmail('user-1', { token: 'uuid-token' });

      expect(result).toEqual(expect.objectContaining({ message: expect.any(String) }));
      expect(prisma.verificationToken.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: 'user-1', token: 'uuid-token' }),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should throw BadRequestException for expired code', async () => {
      const token = {
        id: 'token-1',
        userId: 'user-1',
        code: '123456',
        token: 'uuid-token',
        type: TOKEN_TYPE.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() - 60 * 1000),
        usedAt: null,
      };
      prisma.verificationToken.findFirst.mockResolvedValue(token);

      await expect(
        service.verifyEmail('user-1', { code: '123456' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for already-used code', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyEmail('user-1', { code: '999999' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when neither code nor token provided', async () => {
      await expect(
        service.verifyEmail('user-1', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendVerification', () => {
    it('should generate new code and send email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com', emailVerified: null });
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.verificationToken.create.mockResolvedValue({ id: 'token-2', code: '654321', token: 'new-uuid' });
      mail.send.mockResolvedValue(undefined);

      await service.resendVerification('user-1');

      expect(prisma.verificationToken.create).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com' }),
      );
    });

    it('should throw BadRequestException if already verified', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com', emailVerified: new Date() });

      await expect(
        service.resendVerification('user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resendVerification('nonexistent'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    const dto = { email: 'test@example.com', password: 'StrongPass1' };

    it('should return tokens for valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        password: 'hashed',
        emailVerified: new Date(),
        deletedAt: null,
      });
      mockBcrypt.compare.mockResolvedValue(true as never);
      jwt.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await service.login(dto);

      expect(result).toEqual(
        expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        }),
      );
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        password: 'hashed',
        emailVerified: new Date(),
        deletedAt: null,
      });
      mockBcrypt.compare.mockResolvedValue(false as never);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('unverified user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        password: 'hashed',
        emailVerified: null,
        deletedAt: null,
      });
      mockBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.login(dto);
      expect(result.emailVerified).toBeNull();
    });
  });

  describe('forgotPassword', () => {
    it('should send reset email for existing user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({ id: 'token-1', code: '123456', token: 'uuid' });
      mail.send.mockResolvedValue(undefined);

      const result = await service.forgotPassword({ email: 'test@example.com' });

      expect(mail.send).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ message: expect.any(String) }));
    });

    it('should return 200 even if user does not exist (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'nonexistent@example.com' });

      expect(mail.send).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ message: expect.any(String) }));
    });
  });

  describe('resetPassword', () => {
    const dto = { email: 'test@example.com', code: '123456', newPassword: 'NewStrongPass1' };

    it('should hash new password and update user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: dto.email });
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        code: '123456',
        type: TOKEN_TYPE.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        usedAt: null,
      });
      mockBcrypt.hash.mockResolvedValue('new-hashed' as never);
      prisma.verificationToken.update.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await service.resetPassword(dto);

      expect(mockBcrypt.hash).toHaveBeenCalledWith(dto.newPassword, 12);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: 'new-hashed' },
      });
    });

    it('should throw BadRequestException for invalid code', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: dto.email });
      prisma.verificationToken.findFirst.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired code', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: dto.email });
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        code: '123456',
        type: TOKEN_TYPE.PASSWORD_RESET,
        expiresAt: new Date(Date.now() - 60 * 1000),
        usedAt: null,
      });

      await expect(service.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens for valid refresh token', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'test@example.com' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com', deletedAt: null });
      jwt.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');

      const result = await service.refreshToken({ refreshToken: 'valid-refresh' });

      expect(result).toEqual(
        expect.objectContaining({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        }),
      );
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid'));

      await expect(
        service.refreshToken({ refreshToken: 'invalid' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
