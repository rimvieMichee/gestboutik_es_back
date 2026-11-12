import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryActivityDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  boutiqueId?: string;

  // Une action précise (ex. SALE_CREATED). Absent : tout sauf les connexions,
  // qui sont très nombreuses ; USER_LOGIN les affiche explicitement.
  @IsOptional()
  @IsString()
  action?: string;
}
