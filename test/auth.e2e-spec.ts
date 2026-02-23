import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaTestHelper } from './helpers/prisma-test.helper';
import { UserFactory } from '../src/database/factories/user.factory';
import { VerificationTokenFactory } from '../src/database/factories/verification-token.factory';

describe('Auth (E2E)', () => {
  let app: INestApplication<App>;
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

    mailSend = jest.fn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(MailService)
      .useValue({ send: mailSend })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    const httpAdapterHost = app.get(HttpAdapterHost);
    app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  beforeEach(async () => {
    await db.clean();
    mailSend.mockClear();
  });

  afterAll(async () => {
    await app.close();
    await db.disconnect();
  });

  function registerUser(email: string, password = 'StrongPass1') {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password });
  }

  describe('POST /api/v1/auth/register', () => {
    it('should return 201 with tokens and correct response shape', async () => {
      const res = await registerUser('new@example.com').expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            id: expect.any(String),
            email: 'new@example.com',
            accessToken: expect.any(String),
            refreshToken: expect.any(String),
            message: expect.any(String),
          }),
          timestamp: expect.any(String),
        }),
      );
      expect(res.body.data.accessToken.split('.')).toHaveLength(3);
      expect(res.body.data.refreshToken.split('.')).toHaveLength(3);
      expect(res.body.data).not.toHaveProperty('password');
    });

    it('should return 400 for missing email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ password: 'StrongPass1' })
        .expect(400);
    });

    it('should return 400 for invalid email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'StrongPass1' })
        .expect(400);
    });

    it('should return 400 for short password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com', password: 'Ab1' })
        .expect(400);
    });

    it('should return 400 for password without uppercase', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com', password: 'weakpassword1' })
        .expect(400);
    });

    it('should return 400 for unknown fields (whitelist)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com', password: 'StrongPass1', admin: true })
        .expect(400);
    });

    it('should return 409 for duplicate email', async () => {
      await userFactory.create({ email: 'dup@example.com' });

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'dup@example.com', password: 'StrongPass1' })
        .expect(409);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return 200 with access and refresh tokens', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'login@test.com',
        password: hashed,
        emailVerified: new Date(),
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'login@test.com', password: 'StrongPass1' })
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        }),
      );
      expect(res.body.data).not.toHaveProperty('password');
    });

    it('should return 401 for wrong password', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'badpw@test.com',
        password: hashed,
        emailVerified: new Date(),
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'badpw@test.com', password: 'WrongPass1' })
        .expect(401);
    });

    it('should return tokens with emailVerified null for unverified user', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'unverified@test.com',
        password: hashed,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'unverified@test.com', password: 'StrongPass1' })
        .expect(200);

      expect(res.body.data.emailVerified).toBeNull();
      expect(res.body.data.accessToken).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('should return 200 for valid code with auth token', async () => {
      const regRes = await registerUser('vcode@test.com').expect(201);
      const accessToken = regRes.body.data.accessToken;

      const vTokens = await prisma.verificationToken.findMany({
        where: { userId: regRes.body.data.id },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: vTokens[0].code })
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('should return 401 without auth token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ code: '123456' })
        .expect(401);
    });

    it('should return 400 for invalid code', async () => {
      const regRes = await registerUser('badcode@test.com').expect(201);
      const accessToken = regRes.body.data.accessToken;

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '999999' })
        .expect(400);
    });

    it('should return 400 for expired code', async () => {
      const user = await userFactory.create({ email: 'expcode@test.com' });
      await tokenFactory.createExpired({ userId: user.id, code: '111111' });

      const regRes = await registerUser('expcode-reg@test.com').expect(201);
      const accessToken = regRes.body.data.accessToken;

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '111111' })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/resend-verification', () => {
    it('should return 200 and resend email with auth token', async () => {
      const regRes = await registerUser('resend@test.com').expect(201);
      const accessToken = regRes.body.data.accessToken;
      mailSend.mockClear();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .set('Authorization', `Bearer ${accessToken}`)
        .send()
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({ message: expect.any(String) }),
      );
      expect(mailSend).toHaveBeenCalled();
    });

    it('should return 401 without auth token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send()
        .expect(401);
    });

    it('should return 400 if already verified', async () => {
      const regRes = await registerUser('alreadyv@test.com').expect(201);
      const accessToken = regRes.body.data.accessToken;

      const vTokens = await prisma.verificationToken.findMany({
        where: { userId: regRes.body.data.id },
      });
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: vTokens[0].code })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .set('Authorization', `Bearer ${accessToken}`)
        .send()
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should return 200 for existing user', async () => {
      await userFactory.create({ email: 'forgot@test.com' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'forgot@test.com' })
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('should return 200 even for non-existent user (no enumeration)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ghost@test.com' })
        .expect(200);
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('should return 200 and reset password', async () => {
      const hashed = await bcrypt.hash('OldPass1', 12);
      const user = await userFactory.create({
        email: 'resetpw@test.com',
        password: hashed,
        emailVerified: new Date(),
      });
      const vToken = await tokenFactory.createPasswordReset({
        userId: user.id,
        code: '654321',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ email: 'resetpw@test.com', code: '654321', newPassword: 'NewStrongPass1' })
        .expect(200);

      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      const valid = await bcrypt.compare('NewStrongPass1', updatedUser!.password!);
      expect(valid).toBe(true);
    });

    it('should return 400 for invalid code', async () => {
      await userFactory.create({ email: 'badresetcode@test.com' });

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ email: 'badresetcode@test.com', code: '000000', newPassword: 'NewStrongPass1' })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should return 200 with new tokens', async () => {
      const hashed = await bcrypt.hash('StrongPass1', 12);
      await userFactory.create({
        email: 'refreshe2e@test.com',
        password: hashed,
        emailVerified: new Date(),
      });

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'refreshe2e@test.com', password: 'StrongPass1' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginRes.body.data.refreshToken })
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        }),
      );
    });

    it('should return 401 for invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'garbage-token' })
        .expect(401);
    });
  });
});
