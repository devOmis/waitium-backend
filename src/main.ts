import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';



async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  //   base url
  app.setGlobalPrefix('api');

  //  API Versioning
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Throw on unknown properties
      transform: true, // Auto-transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  //   Global Filters
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  //   Global Interceptors
  app.useGlobalInterceptors(new TransformInterceptor());

  //   cors
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? '*',
  });

  //   Swagger
  const config = new DocumentBuilder()
    .setTitle('Waitium API')
    .setDescription('Waitium API Documentation')
    .setVersion('1.0')
    .addTag('waitium')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
