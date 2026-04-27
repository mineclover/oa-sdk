import { ApiProperty } from '@nestjs/swagger'

export class UserDto {
  @ApiProperty({ format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string

  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Alice' })
  name!: string

  @ApiProperty({ format: 'email', example: 'alice@example.com' })
  email!: string

  @ApiProperty({ format: 'date-time' })
  createdAt!: string
}
