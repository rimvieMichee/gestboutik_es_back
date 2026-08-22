import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';

// La quantité disponible ne se modifie jamais directement : elle passe par le module Stock
// (RESTOCK / ADJUSTMENT) afin de garder un historique fiable des mouvements.
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['quantiteDisponible', 'boutiqueId'] as const),
) {}
