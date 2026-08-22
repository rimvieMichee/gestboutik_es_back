import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class RestockDto {
  @IsString()
  productId: string;

  @IsInt()
  @IsPositive()
  quantite: number;

  @IsOptional()
  @IsString()
  note?: string;
}
