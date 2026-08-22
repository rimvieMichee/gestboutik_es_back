import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SaleItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @IsPositive()
  quantite: number;
}

// Volontairement : aucun prix ni total n'est accepté du client, ils sont toujours
// recalculés côté serveur à partir du prix courant du produit en base.
export class CreateSaleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];
}
