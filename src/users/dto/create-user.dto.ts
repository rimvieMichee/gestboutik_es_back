import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

// Le rôle créé n'est jamais fourni par le client : il est déduit du rôle de
// l'acteur (SUPER_ADMIN crée un ADMIN, ADMIN crée un EMPLOYEE), voir
// UsersService.create. boutiqueId n'est utile que pour un SUPER_ADMIN créant
// un ADMIN — pour un ADMIN créant un EMPLOYEE, la boutique est toujours la sienne.
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

  @IsOptional()
  @IsString()
  boutiqueId?: string;
}
