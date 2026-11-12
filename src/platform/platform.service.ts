import { Injectable } from '@nestjs/common';
import {
  BoutiqueStatus,
  Prisma,
  ProductStatus,
  Role,
  SaleStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { QueryActivityDto } from './dto/query-activity.dto';
import {
  daysAgoUtc,
  fillDays,
  startOfDayUtc,
  startOfMonthUtc,
  startOfYearUtc,
} from './stats.util';

const num = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);

/** Suivi global de la plateforme pour le technicien (SUPER_ADMIN). */
@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  private salesAggregate(where: Prisma.SaleWhereInput) {
    return this.prisma.sale.aggregate({
      where: { statut: SaleStatus.COMPLETED, ...where },
      _count: { _all: true },
      _sum: { montantTotal: true },
    });
  }

  async overview() {
    const now = new Date();
    const day = startOfDayUtc(now);
    const month = startOfMonthUtc(now);
    const year = startOfYearUtc(now);
    const since30 = daysAgoUtc(29);
    const sevenDaysAgo = daysAgoUtc(7);

    const [
      boutiquesParStatut,
      utilisateurs,
      produitsActifs,
      produitsRupture,
      stockBas,
      jour,
      mois,
      annee,
      total,
      credits,
      serieRows,
      topRows,
      activeBoutiques,
      dernieresVentes,
      activite,
    ] = await Promise.all([
      this.prisma.boutique.groupBy({
        by: ['statut'],
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['role', 'statut'],
        where: { role: { in: [Role.ADMIN, Role.EMPLOYEE] } },
        _count: { _all: true },
      }),
      this.prisma.product.count({ where: { statut: ProductStatus.ACTIVE } }),
      this.prisma.product.count({
        where: { statut: ProductStatus.ACTIVE, quantiteDisponible: { lte: 0 } },
      }),
      this.prisma.$queryRaw<Array<{ c: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS c FROM products
        WHERE statut = 'ACTIVE'::"ProductStatus"
          AND "quantiteDisponible" > 0
          AND "quantiteDisponible" <= "seuilAlerte"`),
      this.salesAggregate({ createdAt: { gte: day } }),
      this.salesAggregate({ createdAt: { gte: month } }),
      this.salesAggregate({ createdAt: { gte: year } }),
      this.salesAggregate({}),
      this.salesAggregate({ isCredit: true, creditRegleAt: null }),
      this.prisma.$queryRaw<
        Array<{ date: string; nombre: number; ca: number }>
      >(
        Prisma.sql`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
                 COUNT(*)::int AS nombre,
                 COALESCE(SUM("montantTotal"), 0)::float AS ca
          FROM sales
          WHERE statut = 'COMPLETED'::"SaleStatus" AND "createdAt" >= ${since30}
          GROUP BY 1 ORDER BY 1`,
      ),
      this.prisma.sale.groupBy({
        by: ['boutiqueId'],
        where: { statut: SaleStatus.COMPLETED, createdAt: { gte: month } },
        _count: { _all: true },
        _sum: { montantTotal: true },
        orderBy: { _sum: { montantTotal: 'desc' } },
        take: 5,
      }),
      this.prisma.boutique.findMany({
        where: { statut: BoutiqueStatus.ACTIVE },
        select: { id: true, nom: true, ville: true, createdAt: true },
        take: 500,
      }),
      this.prisma.sale.groupBy({
        by: ['boutiqueId'],
        where: { statut: SaleStatus.COMPLETED },
        _max: { createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { action: { not: 'USER_LOGIN' } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          user: { select: { nom: true, prenom: true, username: true } },
          boutique: { select: { id: true, nom: true } },
        },
      }),
    ]);

    const count = (role: Role, statut?: UserStatus) =>
      utilisateurs
        .filter((u) => u.role === role && (!statut || u.statut === statut))
        .reduce((sum, u) => sum + u._count._all, 0);
    const boutiqueCount = (statut: BoutiqueStatus) =>
      boutiquesParStatut.find((b) => b.statut === statut)?._count._all ?? 0;

    // Meilleures boutiques du mois, avec leur nom.
    const topNames = await this.prisma.boutique.findMany({
      where: { id: { in: topRows.map((r) => r.boutiqueId) } },
      select: { id: true, nom: true, ville: true },
    });
    const topBoutiques = topRows.map((row) => {
      const b = topNames.find((n) => n.id === row.boutiqueId);
      return {
        id: row.boutiqueId,
        nom: b?.nom ?? '—',
        ville: b?.ville ?? null,
        nombreVentes: row._count._all,
        chiffreAffaires: num(row._sum.montantTotal),
      };
    });

    // Boutiques actives sans vente depuis 7 jours (ou jamais) : à relancer.
    const lastSaleById = new Map(
      dernieresVentes.map((r) => [r.boutiqueId, r._max.createdAt]),
    );
    const sansActivite = activeBoutiques
      .map((b) => ({
        id: b.id,
        nom: b.nom,
        ville: b.ville,
        creeLe: b.createdAt,
        derniereVente: lastSaleById.get(b.id) ?? null,
      }))
      .filter((b) => !b.derniereVente || b.derniereVente < sevenDaysAgo)
      .sort(
        (a, b) =>
          (a.derniereVente?.getTime() ?? 0) - (b.derniereVente?.getTime() ?? 0),
      )
      .slice(0, 6);

    const periode = (agg: typeof jour) => ({
      nombre: agg._count._all,
      chiffreAffaires: num(agg._sum.montantTotal),
    });

    return {
      boutiques: {
        total: boutiqueCount('ACTIVE') + boutiqueCount('INACTIVE'),
        actives: boutiqueCount('ACTIVE'),
        inactives: boutiqueCount('INACTIVE'),
      },
      gestionnaires: {
        total: count(Role.ADMIN),
        actifs: count(Role.ADMIN, UserStatus.ACTIVE),
      },
      employes: {
        total: count(Role.EMPLOYEE),
        actifs: count(Role.EMPLOYEE, UserStatus.ACTIVE),
      },
      produits: {
        actifs: produitsActifs,
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
        montant: num(credits._sum.montantTotal),
      },
      serie: fillDays(serieRows, 30),
      topBoutiques,
      sansActivite,
      activiteRecente: activite,
    };
  }

  async activity(query: QueryActivityDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AuditLogWhereInput = {
      ...(query.boutiqueId ? { boutiqueId: query.boutiqueId } : {}),
      action: query.action ? query.action : { not: 'USER_LOGIN' },
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              nom: true,
              prenom: true,
              username: true,
              role: true,
            },
          },
          boutique: { select: { id: true, nom: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(page, limit, total) };
  }
}
