import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProductStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryProductDto extends PaginationQueryDto {
  // Ignoré (forcé) pour un EMPLOYEE : sa boutique est déduite du token.
  @IsOptional()
  @IsString()
  boutiqueId?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  statut?: ProductStatus;
}
