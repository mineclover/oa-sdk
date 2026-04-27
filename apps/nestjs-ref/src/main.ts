import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const config = new DocumentBuilder()
    .setTitle('NestJS Reference API')
    .setDescription('Reference NestJS API — managed by oa-sdk governance tools')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
  })

  await app.listen(3000)
  console.log('Server:    http://localhost:3000')
  console.log('Swagger:   http://localhost:3000/docs')
  console.log('OpenAPI:   http://localhost:3000/openapi.json')
}

bootstrap().catch(err => {
  console.error(err)
  process.exit(1)
})
