import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { StockService } from './stock.service';
import { RestockDto } from './dto/restock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock')
export class StockController {
  constructor(private stockService: StockService) {}

  @Roles(Role.SUPER_ADMIN)
  @Post('restock')
  restock(@Body() dto: RestockDto) {
    return this.stockService.restock(dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('adjustment')
  adjust(@Body() dto: AdjustStockDto) {
    return this.stockService.adjust(dto);
  }

  // Historique consultable par l'employé (scopé à sa boutique) et l'admin.
  @Get('movements')
  findMovements(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryStockMovementDto,
  ) {
    return this.stockService.findMovements(user, query);
  }
}
