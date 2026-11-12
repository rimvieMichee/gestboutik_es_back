import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, Role, SaleStatus } from '@prisma/client';
import { hashPassword } from '../common/utils/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { QueryBoutiqueDto } from './dto/query-boutique.dto';
import {
  daysAgoUtc,
  fillDays,
  startOfDayUtc,
  startOfMonthUtc,
  startOfYearUtc,
} from '../platform/stats.util';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { CreateBoutiqueDto } from './dto/create-boutique.dto';
import { UpdateBoutiqueDto } from './dto/update-boutique.dto';
import { ChangeBoutiqueStatusDto } from './dto/change-status.dto';

@Injectable()
export class BoutiquesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private authCache: AuthCacheService,
  ) {}

  async create(dto: CreateBoutiqueDto) {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.adminUsername },
    });
    if (existing) {
      throw new ConflictException(
        'Ce nom d’utilisateur (admin) est déjà utilisé.',
      );
    }

    const adminPasswordHash = await hashPassword(dto.adminPassword);

    return this.prisma.$transaction(
      async (tx) => {
        const boutique = await tx.boutique.create({
          data: {
            nom: dto.nom,
            description: dto.description,
            telephone: dto.telephone,
            email: dto.email,
            adresse: dto.adresse,
            ville: dto.ville,
          },
        });

        await this.auditService.record(
          {
            action: 'BOUTIQUE_CREATED',
            entity: 'Boutique',
            entityId: boutique.id,
            boutiqueId: boutique.id,
            metadata: { nom: boutique.nom, gestionnaire: dto.adminUsername },
          },
          tx,
        );

        const admin = await tx.user.create({
          data: {
            nom: dto.adminNom,
            prenom: dto.adminPrenom,
            username: dto.adminUsername,
            passwordHash: adminPasswordHash,
            role: Role.ADMIN,
            boutiqueId: boutique.id,
          },
          select: { id: true, nom: true, prenom: true, username: true },
        });

        return { ...boutique, admin };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  async findAll(query: QueryBoutiqueDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.BoutiqueWhereInput = {
      ...(query.statut ? { statut: query.statut } : {}),
      ...(query.search
        ? {
            OR: [
              { nom: { contains: query.search, mode: 'insensitive' } },
              { ville: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [boutiques, total] = await Promise.all([
      this.prisma.boutique.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      }),
      this.prisma.boutique.count({ where }),
    ]);

    return {
      data: await this.withStats(boutiques),
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  /**
   * Ajoute à chaque boutique de la page ses indicateurs de suivi : gestionnaires,
   * effectifs, produits, ventes du mois, crédits dus et dernière vente. Une
   * requête groupée par indicateur (et non une par boutique).
   */
  private async withStats<T extends { id: string }>(boutiques: T[]) {
    if (!boutiques.length) return [];
    const ids = boutiques.map((b) => b.id);
    const completed = { statut: SaleStatus.COMPLETED, boutiqueId: { in: ids } };

    const [users, products, salesMonth, lastSales, credits] = await Promise.all(
      [
        this.prisma.user.findMany({
          where: { boutiqueId: { in: ids } },
          select: {
            id: true,
            nom: true,
            prenom: true,
            username: true,
            telephone: true,
            role: true,
            statut: true,
            boutiqueId: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.product.groupBy({
          by: ['boutiqueId'],
          where: { boutiqueId: { in: ids }, statut: ProductStatus.ACTIVE },
          _count: { _all: true },
        }),
        this.prisma.sale.groupBy({
          by: ['boutiqueId'],
          where: { ...completed, createdAt: { gte: startOfMonthUtc() } },
          _count: { _all: true },
          _sum: { montantTotal: true },
        }),
        this.prisma.sale.groupBy({
          by: ['boutiqueId'],
          where: completed,
          _max: { createdAt: true },
        }),
        this.prisma.sale.groupBy({
          by: ['boutiqueId'],
          where: { ...completed, isCredit: true, creditRegleAt: null },
          _count: { _all: true },
          _sum: { montantTotal: true },
        }),
      ],
    );

    return boutiques.map((boutique) => {
      const mine = users.filter((u) => u.boutiqueId === boutique.id);
      const month = salesMonth.find((r) => r.boutiqueId === boutique.id);
      const credit = credits.find((r) => r.boutiqueId === boutique.id);
      return {
        ...boutique,
        gestionnaires: mine.filter((u) => u.role === Role.ADMIN),
        stats: {
          employes: mine.filter((u) => u.role === Role.EMPLOYEE).length,
          produits:
            products.find((r) => r.boutiqueId === boutique.id)?._count._all ??
            0,
          ventesMois: {
            nombre: month?._count._all ?? 0,
            chiffreAffaires: Number(month?._sum.montantTotal ?? 0),
          },
          creditEnCours: {
            nombre: credit?._count._all ?? 0,
            montant: Number(credit?._sum.montantTotal ?? 0),
          },
          derniereVente:
            lastSales.find((r) => r.boutiqueId === boutique.id)?._max
              .createdAt ?? null,
        },
      };
    });
  }

  /** Fiche de suivi complète d'une boutique (page détail du technicien). */
  async overview(id: string) {
    const boutique = await this.findOne(id);
    const now = new Date();
    const day = startOfDayUtc(now);
    const month = startOfMonthUtc(now);
    const year = startOfYearUtc(now);
    const since30 = daysAgoUtc(29);
    const base = { boutiqueId: id, statut: SaleStatus.COMPLETED };
    const aggregate = (where: Prisma.SaleWhereInput) =>
      this.prisma.sale.aggregate({
        where: { ...base, ...where },
        _count: { _all: true },
        _sum: { montantTotal: true },
      });
    const periode = (agg: Awaited<ReturnType<typeof aggregate>>) => ({
      nombre: agg._count._all,
      chiffreAffaires: Number(agg._sum.montantTotal ?? 0),
    });

    const [
      users,
      logins,
      produitsActifs,
      produitsArchives,
      produitsRupture,
      stockBas,
      jour,
      mois,
      annee,
      total,
      credits,
      serieRows,
      topItems,
      ventes,
      activite,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: { boutiqueId: id },
        select: {
          id: true,
          nom: true,
          prenom: true,
          username: true,
          telephone: true,
          email: true,
          role: true,
          statut: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.auditLog.groupBy({
        by: ['userId'],
        where: { boutiqueId: id, action: 'USER_LOGIN' },
        _max: { createdAt: true },
      }),
      this.prisma.product.count({
        where: { boutiqueId: id, statut: ProductStatus.ACTIVE },
      }),
      this.prisma.product.count({
        where: { boutiqueId: id, statut: ProductStatus.INACTIVE },
      }),
      this.prisma.product.count({
        where: {
          boutiqueId: id,
          statut: ProductStatus.ACTIVE,
          quantiteDisponible: { lte: 0 },
        },
      }),
      this.prisma.$queryRaw<Array<{ c: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS c FROM products
        WHERE "boutiqueId" = ${id} AND statut = 'ACTIVE'::"ProductStatus"
          AND "quantiteDisponible" > 0
          AND "quantiteDisponible" <= "seuilAlerte"`),
      aggregate({ createdAt: { gte: day } }),
      aggregate({ createdAt: { gte: month } }),
      aggregate({ createdAt: { gte: year } }),
      aggregate({}),
      aggregate({ isCredit: true, creditRegleAt: null }),
      this.prisma.$queryRaw<
        Array<{ date: string; nombre: number; ca: number }>
      >(
        Prisma.sql`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
                 COUNT(*)::int AS nombre,
                 COALESCE(SUM("montantTotal"), 0)::float AS ca
          FROM sales
          WHERE "boutiqueId" = ${id} AND statut = 'COMPLETED'::"SaleStatus"
            AND "createdAt" >= ${since30}
          GROUP BY 1 ORDER BY 1`,
      ),
      this.prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: { ...base, createdAt: { gte: month } } },
        _sum: { quantite: true, sousTotal: true },
        orderBy: { _sum: { sousTotal: 'desc' } },
        take: 5,
      }),
      this.prisma.sale.findMany({
        where: base,
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { nom: true, prenom: true } },
          items: { select: { quantite: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { boutiqueId: id, action: { not: 'USER_LOGIN' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { nom: true, prenom: true, username: true } },
        },
      }),
    ]);

    const productNames = await this.prisma.product.findMany({
      where: { id: { in: topItems.map((t) => t.productId) } },
      select: { id: true, nom: true },
    });
    const lastLogin = new Map(logins.map((l) => [l.userId, l._max.createdAt]));
    const withLogin = (u: (typeof users)[number]) => ({
      ...u,
      derniereConnexion: lastLogin.get(u.id) ?? null,
    });

    return {
      boutique,
      gestionnaires: users.filter((u) => u.role === Role.ADMIN).map(withLogin),
      employes: users.filter((u) => u.role === Role.EMPLOYEE).map(withLogin),
      produits: {
        actifs: produitsActifs,
        archives: produitsArchives,
        enRupture: produitsRupture,
        stockBas: stockBas[0]?.c ?? 0,
      },
      ventes: {
        jour: periode(jour),
        mois: periode(mois),
        annee: periode(annee),
        total: periode(total),
      },
      credits: {
        nombre: credits._count._all,
        montant: Number(credits._sum.montantTotal ?? 0),
      },
      serie: fillDays(serieRows, 30),
      topProduits: topItems.map((t) => ({
        nom: productNames.find((p) => p.id === t.productId)?.nom ?? '—',
        quantite: t._sum.quantite ?? 0,
        chiffreAffaires: Number(t._sum.sousTotal ?? 0),
      })),
      ventesRecentes: ventes.map((sale) => ({
        id: sale.id,
        numeroVente: sale.numeroVente,
        date: sale.createdAt,
        montantTotal: Number(sale.montantTotal),
        isCredit: sale.isCredit,
        clientNom: sale.clientNom,
        creditRegleAt: sale.creditRegleAt,
        vendeur: `${sale.user.prenom} ${sale.user.nom}`.trim(),
        articles: sale.items.reduce((sum, i) => sum + i.quantite, 0),
      })),
      activiteRecente: activite,
    };
  }

  async findOne(id: string) {
    const boutique = await this.prisma.boutique.findUnique({ where: { id } });
    if (!boutique) {
      throw new NotFoundException('Boutique introuvable.');
    }
    return boutique;
  }

  async update(id: string, dto: UpdateBoutiqueDto) {
    await this.findOne(id);
    const boutique = await this.prisma.boutique.update({
      where: { id },
      data: dto,
    });
    await this.auditService.record({
      action: 'BOUTIQUE_UPDATED',
      entity: 'Boutique',
      entityId: id,
      boutiqueId: id,
      metadata: { nom: boutique.nom },
    });
    return boutique;
  }

  async changeStatus(
    id: string,
    dto: ChangeBoutiqueStatusDto,
    actor: AuthenticatedUser,
  ) {
    await this.findOne(id);
    const boutique = await this.prisma.boutique.update({
      where: { id },
      data: { statut: dto.statut },
    });
    // Tous les comptes de la boutique doivent être revérifiés immédiatement.
    this.authCache.clear();
    await this.auditService.record({
      action: 'BOUTIQUE_STATUS_CHANGED',
      entity: 'Boutique',
      entityId: id,
      userId: actor.userId,
      boutiqueId: id,
      metadata: { statut: dto.statut },
    });
    return boutique;
  }
}
