import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(8, {
    message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.',
  })
  newPassword: string;

  // Refresh token de la session courante : il reste valide, les sessions des
  // autres appareils sont fermées.
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
