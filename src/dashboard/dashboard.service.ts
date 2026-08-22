import { Injectable } from '@nestjs/common';
import { BoutiqueStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalBoutiques,
      activeBoutiques,
      totalEmployees,
      totalSales,
      revenueAgg,
      ventesDuJour,
      ventesSemaine,
      ventesMois,
    ] = await Promise.all([
      this.prisma.boutique.count(),
      this.prisma.boutique.count({ where: { statut: BoutiqueStatus.ACTIVE } }),
      this.prisma.user.count({ where: { role: Role.EMPLOYEE } }),
      this.prisma.sale.count(),
      this.prisma.sale.aggregate({ _sum: { montantTotal: true } }),
      this.aggregateSalesSince(startOfDay),
      this.aggregateSalesSince(startOfWeek),
      this.aggregateSalesSince(startOfMonth),
    ]);

    return {
      totalBoutiques,
      activeBoutiques,
      totalEmployees,
      totalSales,
      chiffreAffaires: revenueAgg._sum.montantTotal ?? 0,
      ventesDuJour,
      ventesSemaine,
      ventesMois,
    };
  }

  private async aggregateSalesSince(date: Date) {
    const [count, sum] = await Promise.all([
      this.prisma.sale.count({ where: { createdAt: { gte: date } } }),
      this.prisma.sale.aggregate({
        _sum: { montantTotal: true },
        where: { createdAt: { gte: date } },
      }),
    ]);
    return { nombreVentes: count, chiffreAffaires: sum._sum.montantTotal ?? 0 };
  }

  async getSalesByBoutique() {
    const grouped = await this.prisma.sale.groupBy({
      by: ['boutiqueId'],
      _sum: { montantTotal: true },
      _count: { _all: true },
    });
    const boutiques = await this.prisma.boutique.findMany({
      where: { id: { in: grouped.map((g) => g.boutiqueId) } },
    });
    const boutiqueById = new Map(boutiques.map((b) => [b.id, b]));

    return grouped
      .map((g) => ({
        boutiqueId: g.boutiqueId,
        boutiqueNom: boutiqueById.get(g.boutiqueId)?.nom ?? 'Boutique inconnue',
        nombreVentes: g._count._all,
        chiffreAffaires: g._sum.montantTotal ?? 0,
      }))
      .sort((a, b) => Number(b.chiffreAffaires) - Number(a.chiffreAffaires));
  }

  async getSalesByEmployee() {
    const grouped = await this.prisma.sale.groupBy({
      by: ['userId'],
      _sum: { montantTotal: true },
      _count: { _all: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      include: { boutique: { select: { id: true, nom: true } } },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return grouped
      .map((g) => {
        const user = userById.get(g.userId);
        return {
          userId: g.userId,
          nomComplet: user
            ? `${user.prenom} ${user.nom}`
            : 'Utilisateur inconnu',
          boutique: user?.boutique ?? null,
          nombreVentes: g._count._all,
          chiffreAffaires: g._sum.montantTotal ?? 0,
        };
      })
      .sort((a, b) => Number(b.chiffreAffaires) - Number(a.chiffreAffaires));
  }

  async getRecentSales(limit = 10) {
    return this.prisma.sale.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        boutique: { select: { id: true, nom: true } },
        user: { select: { id: true, nom: true, prenom: true } },
      },
    });
  }
}
