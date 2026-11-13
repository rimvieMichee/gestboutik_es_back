import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
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

  // all = toute vente à crédit, unpaid = crédit non réglé, paid = crédit réglé,
  // cash = vente au comptant. Absent = toutes les ventes.
  @IsOptional()
  @IsIn(['all', 'unpaid', 'paid', 'cash'])
  credit?: 'all' | 'unpaid' | 'paid' | 'cash';
}

export class SummarySaleQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  // Utile au gestionnaire seulement : totaux d'un employé précis.
  @IsOptional()
  @IsString()
  userId?: string;

  // « all » : rapport consolidé de toutes les boutiques du gestionnaire.
  @IsOptional()
  @IsIn(['all'])
  scope?: 'all';
}
