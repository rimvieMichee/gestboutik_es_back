import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { CreateSaleDto } from './dto/create-sale.dto';
import { QuerySaleDto } from './dto/query-sale.dto';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateSaleDto) {
    if (!user.boutiqueId) {
      throw new ForbiddenException(
        "Aucune boutique n'est associée à ce compte.",
      );
    }
    const boutiqueId = user.boutiqueId;

    // Une seule ligne par produit : on fusionne les doublons envoyés par erreur par le client.
    const quantitiesByProduct = new Map<string, number>();
    for (const item of dto.items) {
      quantitiesByProduct.set(
        item.productId,
        (quantitiesByProduct.get(item.productId) ?? 0) + item.quantite,
      );
    }
    const productIds = [...quantitiesByProduct.keys()];

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });

      const productsById = new Map(products.map((p) => [p.id, p]));
      for (const productId of productIds) {
        const product = productsById.get(productId);
        if (!product) {
          throw new NotFoundException(`Produit ${productId} introuvable.`);
        }
        if (product.boutiqueId !== boutiqueId) {
          throw new ForbiddenException(
            `Le produit "${product.nom}" n'appartient pas à votre boutique.`,
          );
        }
        const quantiteDemandee = quantitiesByProduct.get(productId)!;
        if (product.quantiteDisponible < quantiteDemandee) {
          throw new BadRequestException(
            `Stock insuffisant pour "${product.nom}" (disponible : ${product.quantiteDisponible}, demandé : ${quantiteDemandee}).`,
          );
        }
      }

      let montantTotal = new Prisma.Decimal(0);
      const itemsData: Prisma.SaleItemCreateWithoutSaleInput[] = [];
      for (const productId of productIds) {
        const product = productsById.get(productId)!;
        const quantite = quantitiesByProduct.get(productId)!;
        const prixUnitaire = product.prixVente;
        const sousTotal = new Prisma.Decimal(prixUnitaire).mul(quantite);
        montantTotal = montantTotal.add(sousTotal);
        itemsData.push({
          quantite,
          prixUnitaire,
          sousTotal,
          product: { connect: { id: productId } },
        });
      }

      // Numérotation séquentielle par boutique, atomique grâce au verrou de ligne posé par l'UPDATE.
      const boutique = await tx.boutique.update({
        where: { id: boutiqueId },
        data: { saleCounter: { increment: 1 } },
      });
      const numeroVente = `VENTE-${boutique.saleCounter.toString().padStart(6, '0')}`;

      const sale = await tx.sale.create({
        data: {
          numeroVente,
          boutiqueId,
          userId: user.userId,
          montantTotal,
          items: { create: itemsData },
        },
        include: { items: { include: { product: true } } },
      });

      for (const productId of productIds) {
        const quantite = quantitiesByProduct.get(productId)!;
        const product = productsById.get(productId)!;

        // Décrément atomique et conditionnel : protège contre une vente concurrente
        // qui aurait fait tomber le stock disponible sous le seuil entre-temps.
        const { count } = await tx.product.updateMany({
          where: { id: productId, quantiteDisponible: { gte: quantite } },
          data: { quantiteDisponible: { decrement: quantite } },
        });
        if (count === 0) {
          throw new BadRequestException(
            `Stock insuffisant pour "${product.nom}".`,
          );
        }

        const quantiteApres = product.quantiteDisponible - quantite;
        await tx.stockMovement.create({
          data: {
            productId,
            boutiqueId,
            type: StockMovementType.SALE,
            quantite: -quantite,
            quantiteAvant: product.quantiteDisponible,
            quantiteApres,
            saleId: sale.id,
            userId: user.userId,
          },
        });
      }

      await this.auditService.record(
        {
          action: 'SALE_CREATED',
          entity: 'Sale',
          entityId: sale.id,
          userId: user.userId,
          boutiqueId,
          metadata: {
            numeroVente: sale.numeroVente,
            montantTotal: montantTotal.toString(),
          },
        },
        tx,
      );

      return sale;
    });
  }

  async findAll(user: AuthenticatedUser, query: QuerySaleDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.SaleWhereInput = {};
    if (user.role === Role.EMPLOYEE) {
      // L'employé ne consulte que ses propres ventes, dans sa boutique.
      where.boutiqueId = user.boutiqueId as string;
      where.userId = user.userId;
    } else {
      if (query.boutiqueId) where.boutiqueId = query.boutiqueId;
      if (query.userId) where.userId = query.userId;
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        include: {
          items: { include: { product: true } },
          user: { select: { id: true, nom: true, prenom: true } },
          boutique: { select: { id: true, nom: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(page, limit, total) };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        user: { select: { id: true, nom: true, prenom: true } },
        boutique: { select: { id: true, nom: true } },
      },
    });
    if (!sale) {
      throw new NotFoundException('Vente introuvable.');
    }
    if (user.role === Role.EMPLOYEE && sale.userId !== user.userId) {
      throw new ForbiddenException('Accès refusé à cette vente.');
    }
    return sale;
  }
}
