import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { DashboardService } from './dashboard.service';

// Le tableau de bord est celui de l'ADMIN pour SA boutique : le SUPER_ADMIN
// n'a pas de vue globale ici, ses pages se limitent aux boutiques (voir
// BoutiquesController).
@Roles(Role.ADMIN)
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  getOverview(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboardService.getOverview(actor.boutiqueId as string);
  }

  @Get('sales-by-employee')
  getSalesByEmployee(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboardService.getSalesByEmployee(actor.boutiqueId as string);
  }

  @Get('recent-sales')
  getRecentSales(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getRecentSales(
      actor.boutiqueId as string,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
