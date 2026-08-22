import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  resolveBoutiqueScope,
  assertSameBoutique,
} from '../common/utils/tenant-scope.util';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { RestockDto } from './dto/restock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  restock(actor: AuthenticatedUser, dto: RestockDto) {
    return this.applyMovement(
      actor,
      dto.productId,
      dto.quantite,
      StockMovementType.RESTOCK,
      dto.note,
    );
  }

  adjust(actor: AuthenticatedUser, dto: AdjustStockDto) {
    return this.applyMovement(
      actor,
      dto.productId,
      dto.quantite,
      StockMovementType.ADJUSTMENT,
      dto.note,
    );
  }

  private async applyMovement(
    actor: AuthenticatedUser,
    productId: string,
    delta: number,
    type: StockMovementType,
    note?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new NotFoundException('Produit introuvable.');
      }
      assertSameBoutique(actor, product.boutiqueId);

      if (delta < 0) {
        const { count } = await tx.product.updateMany({
          where: { id: productId, quantiteDisponible: { gte: -delta } },
          data: { quantiteDisponible: { increment: delta } },
        });
        if (count === 0) {
          throw new BadRequestException(
            'Stock insuffisant pour appliquer cet ajustement.',
          );
        }
      } else {
        await tx.product.update({
          where: { id: productId },
          data: { quantiteDisponible: { increment: delta } },
        });
      }

      const quantiteApres = product.quantiteDisponible + delta;
      await tx.stockMovement.create({
        data: {
          productId,
          boutiqueId: product.boutiqueId,
          type,
          quantite: delta,
          quantiteAvant: product.quantiteDisponible,
          quantiteApres,
          note,
        },
      });

      return tx.product.findUnique({ where: { id: productId } });
    });
  }

  async findMovements(user: AuthenticatedUser, query: QueryStockMovementDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const boutiqueId = resolveBoutiqueScope(user, query.boutiqueId);

    const where: Prisma.StockMovementWhereInput = {
      ...(boutiqueId ? { boutiqueId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
        include: { product: { select: { id: true, nom: true, sku: true } } },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(page, limit, total) };
  }
}
