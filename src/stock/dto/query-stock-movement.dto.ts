import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryStockMovementDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  boutiqueId?: string;

  @IsOptional()
  @IsString()
  productId?: string;
}
