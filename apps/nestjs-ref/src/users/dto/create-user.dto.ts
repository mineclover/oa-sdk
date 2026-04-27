import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateUserDto {
  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Alice' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string

  @ApiProperty({ format: 'email', example: 'alice@example.com' })
  @IsEmail()
  email!: string
}
