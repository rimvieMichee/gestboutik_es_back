import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QuerySaleDto extends PaginationQueryDto {
  // Ignoré (forcé) pour un EMPLOYEE : boutique + auteur déduits du token.
  @IsOptional()
  @IsString()
  boutiqueId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
