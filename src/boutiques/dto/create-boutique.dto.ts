import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
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

  // Le SUPER_ADMIN crée la boutique et son gestionnaire en une seule étape, ou
  // rattache à la boutique un gestionnaire existant (adminUserId) : il gérera
  // alors plusieurs boutiques et pourra passer de l'une à l'autre.
  @IsOptional()
  @IsString()
  adminUserId?: string;

  @ValidateIf((o: CreateBoutiqueDto) => !o.adminUserId)
  @IsString()
  @IsNotEmpty()
  adminNom?: string;

  @ValidateIf((o: CreateBoutiqueDto) => !o.adminUserId)
  @IsString()
  @IsNotEmpty()
  adminPrenom?: string;

  // Numéro du gestionnaire : affiché en en-tête de ses rapports PDF.
  @IsOptional()
  @IsString()
  adminTelephone?: string;

  @ValidateIf((o: CreateBoutiqueDto) => !o.adminUserId)
  @IsString()
  @IsNotEmpty()
  adminUsername?: string;

  @ValidateIf((o: CreateBoutiqueDto) => !o.adminUserId)
  @IsString()
  @MinLength(8)
  adminPassword?: string;
}
