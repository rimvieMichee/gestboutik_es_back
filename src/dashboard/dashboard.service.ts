import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview(boutiqueId: string) {
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
      totalEmployees,
      totalProducts,
      totalSales,
      revenueAgg,
      ventesDuJour,
      ventesSemaine,
      ventesMois,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.EMPLOYEE, boutiqueId } }),
      this.prisma.product.count({ where: { boutiqueId } }),
      this.prisma.sale.count({ where: { boutiqueId } }),
      this.prisma.sale.aggregate({
        _sum: { montantTotal: true },
        where: { boutiqueId },
      }),
      this.aggregateSalesSince(boutiqueId, startOfDay),
      this.aggregateSalesSince(boutiqueId, startOfWeek),
      this.aggregateSalesSince(boutiqueId, startOfMonth),
    ]);

    return {
      totalEmployees,
      totalProducts,
      totalSales,
      chiffreAffaires: revenueAgg._sum.montantTotal ?? 0,
      ventesDuJour,
      ventesSemaine,
      ventesMois,
    };
  }

  private async aggregateSalesSince(boutiqueId: string, date: Date) {
    const where = { boutiqueId, createdAt: { gte: date } };
    const [count, sum] = await Promise.all([
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({ _sum: { montantTotal: true }, where }),
    ]);
    return { nombreVentes: count, chiffreAffaires: sum._sum.montantTotal ?? 0 };
  }

  async getSalesByEmployee(boutiqueId: string) {
    const grouped = await this.prisma.sale.groupBy({
      by: ['userId'],
      where: { boutiqueId },
      _sum: { montantTotal: true },
      _count: { _all: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
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
          nombreVentes: g._count._all,
          chiffreAffaires: g._sum.montantTotal ?? 0,
        };
      })
      .sort((a, b) => Number(b.chiffreAffaires) - Number(a.chiffreAffaires));
  }

  async getRecentSales(boutiqueId: string, limit = 10) {
    return this.prisma.sale.findMany({
      where: { boutiqueId },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, nom: true, prenom: true } },
      },
    });
  }
}
