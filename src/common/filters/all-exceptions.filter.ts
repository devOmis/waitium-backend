import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request } from 'express';

interface ExceptionResponseObject {
  message?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const { httpAdapter } = this.httpAdapterHost;

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message: string | ExceptionResponseObject =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const request = ctx.getRequest<Request>();
    const requestUrl = String(httpAdapter.getRequestUrl(request));

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: requestUrl,
      method: request.method,
      message:
        typeof message === 'string'
          ? message
          : message.message || 'Internal server error',
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : '',
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} ${status}`);
    }

    httpAdapter.reply(ctx.getResponse(), errorResponse, status);
  }
}
