import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { QuerySaleDto, SummarySaleQueryDto } from './dto/query-sale.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sales')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Roles(Role.EMPLOYEE)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSaleDto) {
    return this.salesService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QuerySaleDto,
  ) {
    return this.salesService.findAll(user, query);
  }

  // Totaux d'une période (employé : ses ventes ; gestionnaire : la boutique).
  // Déclaré avant ':id' pour ne pas être pris pour un identifiant.
  @Roles(Role.EMPLOYEE, Role.ADMIN)
  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SummarySaleQueryDto,
  ) {
    return this.salesService.summary(user, query);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/settle')
  settle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salesService.settleCredit(user, id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salesService.findOne(user, id);
  }
}
