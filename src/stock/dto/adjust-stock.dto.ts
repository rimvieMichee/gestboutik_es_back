import { IsInt, IsNotEmpty, IsString, NotEquals } from 'class-validator';

export class AdjustStockDto {
  @IsString()
  productId: string;

  // Delta signé appliqué au stock (ex: -2 pour une casse, +5 pour une correction d'inventaire).
  @IsInt()
  @NotEquals(0)
  quantite: number;

  @IsString()
  @IsNotEmpty()
  note: string;
}
