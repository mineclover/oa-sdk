import { ApiProperty } from '@nestjs/swagger'

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'] as const, example: 'ok' })
  status!: 'ok' | 'error'
}
