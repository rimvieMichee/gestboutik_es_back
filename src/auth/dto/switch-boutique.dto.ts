import { IsNotEmpty, IsString } from 'class-validator';

export class SwitchBoutiqueDto {
  @IsString()
  @IsNotEmpty()
  boutiqueId: string;

  // Refresh token de la session courante : il est remplacé par celui de la
  // nouvelle boutique (rotation, comme pour un renouvellement).
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
