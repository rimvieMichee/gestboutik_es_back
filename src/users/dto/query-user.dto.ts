import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryUserDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  boutiqueId?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
