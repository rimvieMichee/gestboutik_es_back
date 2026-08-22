import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateBoutiqueDto {
  @IsString()
  @IsNotEmpty()
  nom: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  adresse?: string;

  @IsOptional()
  @IsString()
  ville?: string;

  // Le SUPER_ADMIN crée la boutique et son administrateur en une seule étape :
  // c'est ce compte Admin qui gérera ensuite les employés de la boutique.
  @IsString()
  @IsNotEmpty()
  adminNom: string;

  @IsString()
  @IsNotEmpty()
  adminPrenom: string;

  @IsString()
  @IsNotEmpty()
  adminUsername: string;

  @IsString()
  @MinLength(8)
  adminPassword: string;
}
