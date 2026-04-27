/**
 * Exports the NestJS Swagger document to contracts/ without starting the HTTP server.
 * Run: pnpm export:openapi
 *
 * Output files:
 *   contracts/openapi.raw.json
 *   contracts/openapi.raw.yaml
 */
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dump as yamlDump } from 'js-yaml'
import { AppModule } from '../src/app.module'

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false })

  const config = new DocumentBuilder()
    .setTitle('NestJS Reference API')
    .setDescription('Reference NestJS API — managed by oa-sdk governance tools')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)
  await app.close()

  mkdirSync('contracts', { recursive: true })

  const json = JSON.stringify(document, null, 2)
  const yaml = yamlDump(document, { indent: 2, lineWidth: 120, noRefs: true })

  writeFileSync('contracts/openapi.raw.json', json)
  writeFileSync('contracts/openapi.raw.yaml', yaml)

  console.log('✓ contracts/openapi.raw.json')
  console.log('✓ contracts/openapi.raw.yaml')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
