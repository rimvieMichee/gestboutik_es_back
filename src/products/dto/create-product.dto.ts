import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  nom: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  prixVente: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  prixAchat?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantiteDisponible?: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  seuilAlerte?: number = 0;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsString()
  @IsNotEmpty()
  boutiqueId: string;
}
