import { IsEnum, IsOptional } from 'class-validator';
import { BoutiqueStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryBoutiqueDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BoutiqueStatus)
  statut?: BoutiqueStatus;
}
