import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { StockService } from './stock.service';
import { RestockDto } from './dto/restock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';

@Controller('stock')
export class StockController {
  constructor(private stockService: StockService) {}

  @Roles(Role.ADMIN)
  @Post('restock')
  restock(@CurrentUser() actor: AuthenticatedUser, @Body() dto: RestockDto) {
    return this.stockService.restock(actor, dto);
  }

  @Roles(Role.ADMIN)
  @Post('adjustment')
  adjust(@CurrentUser() actor: AuthenticatedUser, @Body() dto: AdjustStockDto) {
    return this.stockService.adjust(actor, dto);
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
