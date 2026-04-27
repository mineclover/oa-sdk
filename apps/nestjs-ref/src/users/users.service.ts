import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { CreateUserDto } from './dto/create-user.dto'
import type { UpdateUserDto } from './dto/update-user.dto'
import type { UserDto } from './dto/user.dto'

@Injectable()
export class UsersService {
  private readonly store = new Map<string, UserDto>()

  create(dto: CreateUserDto): UserDto {
    const user: UserDto = {
      id: randomUUID(),
      name: dto.name,
      email: dto.email,
      createdAt: new Date().toISOString(),
    }
    this.store.set(user.id, user)
    return user
  }

  findAll(): UserDto[] {
    return [...this.store.values()]
  }

  findOne(id: string): UserDto | undefined {
    return this.store.get(id)
  }

  update(id: string, dto: UpdateUserDto): UserDto | undefined {
    const existing = this.store.get(id)
    if (existing === undefined) return undefined
    const updated: UserDto = {
      ...existing,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
    }
    this.store.set(id, updated)
    return updated
  }

  remove(id: string): boolean {
    return this.store.delete(id)
  }
}
