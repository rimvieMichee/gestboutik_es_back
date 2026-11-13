import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  Role,
  SaleStatus,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { assertSameBoutique } from '../common/utils/tenant-scope.util';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { CreateSaleDto } from './dto/create-sale.dto';
import { QuerySaleDto, SummarySaleQueryDto } from './dto/query-sale.dto';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private realtime: RealtimeService,
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

    const { sale, stocks } = await this.prisma.$transaction(
      async (tx) => {
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
          if (product.statut !== ProductStatus.ACTIVE) {
            throw new BadRequestException(
              `Le produit "${product.nom}" n'est plus disponible à la vente.`,
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
            isCredit: dto.estCredit === true,
            clientNom: dto.estCredit === true ? dto.clientNom?.trim() : null,
            items: { create: itemsData },
          },
          include: { items: { include: { product: true } } },
        });

        const movements: Prisma.StockMovementCreateManyInput[] = [];
        const stocks: Array<{ id: string; quantiteDisponible: number }> = [];
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

          movements.push({
            productId,
            boutiqueId,
            type: StockMovementType.SALE,
            quantite: -quantite,
            quantiteAvant: product.quantiteDisponible,
            quantiteApres: product.quantiteDisponible - quantite,
            saleId: sale.id,
            userId: user.userId,
          });
          stocks.push({
            id: productId,
            quantiteDisponible: product.quantiteDisponible - quantite,
          });
        }
        // Un seul INSERT pour tous les mouvements de stock.
        await tx.stockMovement.createMany({ data: movements });

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
              credit: sale.isCredit,
              clientNom: sale.clientNom,
            },
          },
          tx,
        );

        return { sale, stocks };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    // Diffusion après validation : écrans de vente et chiffres à jour en direct.
    for (const product of stocks) {
      this.realtime.stockUpdated(boutiqueId, product);
    }
    this.realtime.saleCreated({
      saleId: sale.id,
      numeroVente: sale.numeroVente,
      montantTotal: Number(sale.montantTotal),
      isCredit: sale.isCredit,
      clientNom: sale.clientNom,
      boutiqueId,
      userId: user.userId,
      createdAt: sale.createdAt,
    });
    return sale;
  }

  async findAll(user: AuthenticatedUser, query: QuerySaleDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.SaleWhereInput = {};
    if (user.role === Role.EMPLOYEE) {
      // L'employé ne consulte que ses propres ventes, dans sa boutique.
      where.boutiqueId = user.boutiqueId as string;
      where.userId = user.userId;
    } else if (user.role === Role.ADMIN) {
      // L'admin consulte toutes les ventes de SA boutique (jamais une autre),
      // avec un filtre optionnel par employé.
      where.boutiqueId = user.boutiqueId as string;
      if (query.userId) where.userId = query.userId;
    } else {
      if (query.boutiqueId) where.boutiqueId = query.boutiqueId;
      if (query.userId) where.userId = query.userId;
    }
    Object.assign(where, this.creditFilter(query.credit));
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
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

  private creditFilter(
    credit?: 'all' | 'unpaid' | 'paid' | 'cash',
  ): Prisma.SaleWhereInput {
    switch (credit) {
      case 'cash':
        return { isCredit: false };
      case 'all':
        return { isCredit: true };
      case 'unpaid':
        return { isCredit: true, creditRegleAt: null };
      case 'paid':
        return { isCredit: true, creditRegleAt: { not: null } };
      default:
        return {};
    }
  }

  /**
   * Totaux sur une période (dateFrom/dateTo, calculées côté client dans son
   * fuseau horaire) : ventes, chiffre d'affaires, part à crédit. Un employé ne
   * voit que ses ventes ; le gestionnaire voit toute sa boutique (ou un
   * employé via userId). `creditEnCours` ignore la période : c'est tout ce qui
   * reste dû à ce jour.
   */
  async summary(user: AuthenticatedUser, query: SummarySaleQueryDto) {
    if (!user.boutiqueId) {
      throw new ForbiddenException(
        "Aucune boutique n'est associée à ce compte.",
      );
    }
    const scope: Prisma.SaleWhereInput = {
      boutiqueId: user.boutiqueId,
      statut: SaleStatus.COMPLETED,
      userId: user.role === Role.EMPLOYEE ? user.userId : query.userId,
    };
    const range: Prisma.SaleWhereInput =
      query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {};

    const [all, credit, unpaid] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { ...scope, ...range },
        _count: { _all: true },
        _sum: { montantTotal: true },
      }),
      this.prisma.sale.aggregate({
        where: { ...scope, ...range, isCredit: true },
        _count: { _all: true },
        _sum: { montantTotal: true },
      }),
      this.prisma.sale.aggregate({
        where: { ...scope, isCredit: true, creditRegleAt: null },
        _count: { _all: true },
        _sum: { montantTotal: true },
      }),
    ]);

    return {
      nombreVentes: all._count._all,
      chiffreAffaires: all._sum.montantTotal ?? 0,
      nombreCredits: credit._count._all,
      creditMontant: credit._sum.montantTotal ?? 0,
      creditEnCoursNombre: unpaid._count._all,
      creditEnCoursMontant: unpaid._sum.montantTotal ?? 0,
    };
  }

  /**
   * Rapport complet d'une période (typiquement une journée) pour le gestionnaire :
   * en-tête (boutique, gestionnaire), totaux, et toutes les ventes avec leurs
   * lignes. Sert de base au PDF généré par l'application.
   */
  async report(user: AuthenticatedUser, query: SummarySaleQueryDto) {
    if (!user.boutiqueId) {
      throw new ForbiddenException(
        "Aucune boutique n'est associée à ce compte.",
      );
    }
    // Portée consolidée : toutes les boutiques auxquelles le gestionnaire est rattaché.
    let boutiqueIds = [user.boutiqueId];
    if (query.scope === 'all') {
      const rows = await this.prisma.userBoutique.findMany({
        where: { userId: user.userId },
        select: { boutiqueId: true },
      });
      boutiqueIds = Array.from(
        new Set([user.boutiqueId, ...rows.map((r) => r.boutiqueId)]),
      );
    }
    const consolidated = query.scope === 'all' && boutiqueIds.length > 1;
    const where: Prisma.SaleWhereInput = {
      boutiqueId: { in: boutiqueIds },
      statut: SaleStatus.COMPLETED,
      userId: consolidated ? undefined : query.userId,
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [boutique, gestionnaire, sales] = await Promise.all([
      this.prisma.boutique.findUnique({
        where: { id: user.boutiqueId },
        select: { nom: true, telephone: true, adresse: true, ville: true },
      }),
      this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { nom: true, prenom: true, telephone: true },
      }),
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: 2000,
        include: {
          items: { include: { product: { select: { nom: true } } } },
          user: { select: { nom: true, prenom: true } },
          boutique: { select: { id: true, nom: true } },
        },
      }),
    ]);

    const parBoutique = new Map<
      string,
      { boutiqueId: string; nom: string; nombreVentes: number; chiffreAffaires: Prisma.Decimal; creditDu: Prisma.Decimal }
    >();
    let total = new Prisma.Decimal(0);
    let encaisse = new Prisma.Decimal(0);
    let creditDu = new Prisma.Decimal(0);
    let articles = 0;
    const ventes = sales.map((sale) => {
      const credit = sale.isCredit && sale.creditRegleAt === null;
      total = total.add(sale.montantTotal);
      if (credit) creditDu = creditDu.add(sale.montantTotal);
      else encaisse = encaisse.add(sale.montantTotal);
      const row = parBoutique.get(sale.boutiqueId) ?? {
        boutiqueId: sale.boutiqueId,
        nom: sale.boutique.nom,
        nombreVentes: 0,
        chiffreAffaires: new Prisma.Decimal(0),
        creditDu: new Prisma.Decimal(0),
      };
      row.nombreVentes += 1;
      row.chiffreAffaires = row.chiffreAffaires.add(sale.montantTotal);
      if (credit) row.creditDu = row.creditDu.add(sale.montantTotal);
      parBoutique.set(sale.boutiqueId, row);
      const lignes = sale.items.map((item) => {
        articles += item.quantite;
        return {
          produit: item.product.nom,
          quantite: item.quantite,
          prixUnitaire: item.prixUnitaire,
          sousTotal: item.sousTotal,
        };
      });
      return {
        numeroVente: sale.numeroVente,
        date: sale.createdAt,
        montantTotal: sale.montantTotal,
        // « Crédit » tant que l'emprunteur n'a pas payé, « Payé » sinon.
        statut: credit ? 'CREDIT' : 'PAYE',
        clientNom: sale.clientNom,
        vendeur: `${sale.user.prenom} ${sale.user.nom}`.trim(),
        boutique: sale.boutique.nom,
        lignes,
      };
    });

    // Une ligne par boutique, même celles sans vente sur la période.
    let parBoutiqueListe: unknown[] | undefined;
    if (consolidated) {
      const shops = await this.prisma.boutique.findMany({
        where: { id: { in: boutiqueIds } },
        select: { id: true, nom: true },
        orderBy: { nom: 'asc' },
      });
      parBoutiqueListe = shops.map(
        (b) =>
          parBoutique.get(b.id) ?? {
            boutiqueId: b.id,
            nom: b.nom,
            nombreVentes: 0,
            chiffreAffaires: 0,
            creditDu: 0,
          },
      );
    }

    return {
      boutique: consolidated
        ? { nom: 'Toutes mes boutiques', telephone: null, adresse: null, ville: null }
        : boutique,
      consolide: consolidated,
      parBoutique: parBoutiqueListe,
      gestionnaire,
      totaux: {
        nombreVentes: sales.length,
        articlesVendus: articles,
        chiffreAffaires: total,
        encaisse,
        creditDu,
      },
      ventes,
    };
  }

  /** Le gestionnaire marque un crédit comme réglé (l'emprunteur a payé). */
  async settleCredit(user: AuthenticatedUser, id: string) {
    const sale = await this.findOne(user, id);
    if (!sale.isCredit) {
      throw new BadRequestException("Cette vente n'est pas à crédit.");
    }
    if (sale.creditRegleAt) {
      throw new BadRequestException('Ce crédit est déjà réglé.');
    }
    const updated = await this.prisma.sale.update({
      where: { id },
      data: { creditRegleAt: new Date() },
      include: {
        items: { include: { product: true } },
        user: { select: { id: true, nom: true, prenom: true } },
        boutique: { select: { id: true, nom: true } },
      },
    });
    await this.auditService.record({
      action: 'CREDIT_SETTLED',
      entity: 'Sale',
      entityId: id,
      userId: user.userId,
      boutiqueId: sale.boutiqueId,
      metadata: {
        numeroVente: sale.numeroVente,
        clientNom: sale.clientNom,
        montantTotal: sale.montantTotal.toString(),
      },
    });
    this.realtime.creditSettled({
      saleId: updated.id,
      numeroVente: updated.numeroVente,
      montantTotal: Number(updated.montantTotal),
      isCredit: true,
      clientNom: updated.clientNom,
      boutiqueId: updated.boutiqueId,
      userId: updated.userId,
      createdAt: updated.createdAt,
    });
    return updated;
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
    assertSameBoutique(user, sale.boutiqueId);
    if (user.role === Role.EMPLOYEE && sale.userId !== user.userId) {
      throw new ForbiddenException('Accès refusé à cette vente.');
    }
    return sale;
  }
}
