import { Role } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  nom: string;

  @IsString()
  @IsNotEmpty()
  prenom: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(Role)
  role: Role;

  // Obligatoire pour un EMPLOYEE, doit être absent pour un SUPER_ADMIN (vérifié en service).
  @ValidateIf((dto: CreateUserDto) => dto.role === Role.EMPLOYEE)
  @IsString()
  @IsNotEmpty()
  boutiqueId?: string;
}
