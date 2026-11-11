import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
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

  // Vente à crédit : le nom de l'emprunteur est alors obligatoire.
  @IsOptional()
  @IsBoolean()
  estCredit?: boolean;

  @ValidateIf((o: CreateSaleDto) => o.estCredit === true)
  @IsString()
  @IsNotEmpty({ message: "Le nom de l'emprunteur est obligatoire." })
  @MaxLength(120)
  clientNom?: string;
}
