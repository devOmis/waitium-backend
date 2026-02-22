import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly ses: SESClient;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    this.ses = new SESClient({
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.fromAddress = this.config.get<string>(
      'MAIL_FROM',
      'noreply@waitium.com',
    );
  }

  async send(options: SendEmailOptions): Promise<void> {
    const command = new SendEmailCommand({
      Source: this.fromAddress,
      Destination: { ToAddresses: [options.to] },
      Message: {
        Subject: { Data: options.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: options.html, Charset: 'UTF-8' },
          Text: { Data: options.text, Charset: 'UTF-8' },
        },
      },
    });

    try {
      await this.ses.send(command);
      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${options.to}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
