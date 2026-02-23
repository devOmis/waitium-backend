import {
  Injectable,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { TOKEN_TYPE } from '../../common/enums/token-type.enum';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  verificationEmailHtml,
  verificationEmailText,
} from '../../mail/templates/verification.template';
import {
  passwordResetEmailHtml,
  passwordResetEmailText,
} from '../../mail/templates/password-reset.template';

const BCRYPT_ROUNDS = 12;
const VERIFICATION_EXPIRY_MINUTES = 15;

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
      },
    });

    const code = generateCode();
    const token = randomUUID();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        code,
        token,
        type: TOKEN_TYPE.EMAIL_VERIFICATION,
        expiresAt: new Date(
          Date.now() + VERIFICATION_EXPIRY_MINUTES * 60 * 1000,
        ),
      },
    });

    const frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

    try {
      await this.mail.send({
        to: user.email,
        subject: 'Verify your email address',
        html: verificationEmailHtml({
          code,
          verifyUrl,
          expiresInMinutes: VERIFICATION_EXPIRY_MINUTES,
        }),
        text: verificationEmailText({
          code,
          verifyUrl,
          expiresInMinutes: VERIFICATION_EXPIRY_MINUTES,
        }),
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send verification email to ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const tokens = await this.generateTokens(user.id, user.email);

    this.logger.log(`User registered: ${user.id}`);

    return {
      id: user.id,
      email: user.email,
      ...tokens,
      message: 'Verification email sent',
    };
  }

  async verifyEmail(userId: string, dto: VerifyEmailDto) {
    if (!dto.code && !dto.token) {
      throw new BadRequestException('Either code or token must be provided');
    }

    const whereClause = dto.token
      ? { token: dto.token, type: TOKEN_TYPE.EMAIL_VERIFICATION, userId, usedAt: null }
      : { code: dto.code, type: TOKEN_TYPE.EMAIL_VERIFICATION, userId, usedAt: null };

    const verification = await this.prisma.verificationToken.findFirst({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    if (verification.expiresAt < new Date()) {
      throw new BadRequestException('Verification code has expired');
    }

    await this.prisma.verificationToken.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
    });

    this.logger.log(`Email verified: ${userId}`);

    return { message: 'Email verified successfully' };
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    await this.prisma.verificationToken.updateMany({
      where: {
        userId: user.id,
        type: TOKEN_TYPE.EMAIL_VERIFICATION,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    const code = generateCode();
    const token = randomUUID();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        code,
        token,
        type: TOKEN_TYPE.EMAIL_VERIFICATION,
        expiresAt: new Date(
          Date.now() + VERIFICATION_EXPIRY_MINUTES * 60 * 1000,
        ),
      },
    });

    const frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

    try {
      await this.mail.send({
        to: user.email,
        subject: 'Verify your email address',
        html: verificationEmailHtml({
          code,
          verifyUrl,
          expiresInMinutes: VERIFICATION_EXPIRY_MINUTES,
        }),
        text: verificationEmailText({
          code,
          verifyUrl,
          expiresInMinutes: VERIFICATION_EXPIRY_MINUTES,
        }),
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send verification email to ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(`Verification resent: ${user.id}`);

    return { message: 'Verification email sent' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email, deletedAt: null },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    this.logger.log(`User logged in: ${user.id}`);

    return { ...tokens, emailVerified: user.emailVerified };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const response = {
      message: 'If the email exists, a password reset code has been sent',
    };

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      return response;
    }

    await this.prisma.verificationToken.updateMany({
      where: {
        userId: user.id,
        type: TOKEN_TYPE.PASSWORD_RESET,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    const code = generateCode();
    const token = randomUUID();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        code,
        token,
        type: TOKEN_TYPE.PASSWORD_RESET,
        expiresAt: new Date(
          Date.now() + VERIFICATION_EXPIRY_MINUTES * 60 * 1000,
        ),
      },
    });

    const frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    try {
      await this.mail.send({
        to: user.email,
        subject: 'Reset your password',
        html: passwordResetEmailHtml({
          code,
          resetUrl,
          expiresInMinutes: VERIFICATION_EXPIRY_MINUTES,
        }),
        text: passwordResetEmailText({
          code,
          resetUrl,
          expiresInMinutes: VERIFICATION_EXPIRY_MINUTES,
        }),
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send password reset email to ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(`Password reset requested: ${user.id}`);

    return response;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new BadRequestException('Invalid reset request');
    }

    const verification = await this.prisma.verificationToken.findFirst({
      where: {
        userId: user.id,
        code: dto.code,
        type: TOKEN_TYPE.PASSWORD_RESET,
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    if (verification.expiresAt < new Date()) {
      throw new BadRequestException('Reset code has expired');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.verificationToken.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    this.logger.log(`Password reset: ${user.id}`);

    return { message: 'Password reset successfully' };
  }

  async refreshToken(dto: RefreshTokenDto) {
    try {
      const payload = await this.jwt.verifyAsync(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub, deletedAt: null },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.generateTokens(user.id, user.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
