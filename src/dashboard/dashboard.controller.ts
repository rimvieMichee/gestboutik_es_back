import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  getOverview() {
    return this.dashboardService.getOverview();
  }

  @Get('sales-by-boutique')
  getSalesByBoutique() {
    return this.dashboardService.getSalesByBoutique();
  }

  @Get('sales-by-employee')
  getSalesByEmployee() {
    return this.dashboardService.getSalesByEmployee();
  }

  @Get('recent-sales')
  getRecentSales(@Query('limit') limit?: string) {
    return this.dashboardService.getRecentSales(
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
