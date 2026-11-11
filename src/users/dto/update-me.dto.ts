import { IsOptional, IsString, MaxLength } from 'class-validator';

// Ce qu'un utilisateur peut modifier lui-même : son numéro de téléphone
// (affiché notamment en en-tête des rapports PDF du gestionnaire).
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telephone?: string;
}
