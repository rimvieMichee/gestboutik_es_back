import { IsEnum } from 'class-validator';
import { BoutiqueStatus } from '@prisma/client';

export class ChangeBoutiqueStatusDto {
  @IsEnum(BoutiqueStatus)
  statut: BoutiqueStatus;
}
