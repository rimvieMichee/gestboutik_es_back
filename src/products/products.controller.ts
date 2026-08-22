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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ChangeProductStatusDto } from './dto/change-status.dto';
import { QueryProductDto } from './dto/query-product.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  // L'ADMIN gère les produits de SA boutique (jamais une autre : boutiqueId
  // est déduit de son compte, jamais du client).
  @Roles(Role.ADMIN)
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(actor, dto);
  }

  // Accessible à l'EMPLOYEE et à l'ADMIN (scopés à leur boutique) et au SUPER_ADMIN (vue globale ou filtrée).
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryProductDto,
  ) {
    return this.productsService.findAll(user, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.productsService.findOne(user, id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(actor, id, dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeProductStatusDto,
  ) {
    return this.productsService.changeStatus(actor, id, dto);
  }
}
