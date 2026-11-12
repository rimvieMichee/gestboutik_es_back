import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BoutiquesService } from './boutiques.service';
import { CreateBoutiqueDto } from './dto/create-boutique.dto';
import { UpdateBoutiqueDto } from './dto/update-boutique.dto';
import { ChangeBoutiqueStatusDto } from './dto/change-status.dto';
import { QueryBoutiqueDto } from './dto/query-boutique.dto';

@Controller('boutiques')
export class BoutiquesController {
  constructor(private boutiquesService: BoutiquesService) {}

  // Accessible à l'employé : consulte uniquement sa propre boutique.
  @Get('me')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.boutiquesService.findOne(user.boutiqueId as string);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateBoutiqueDto) {
    return this.boutiquesService.create(dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get()
  findAll(@Query() query: QueryBoutiqueDto) {
    return this.boutiquesService.findAll(query);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get(':id/overview')
  overview(@Param('id') id: string) {
    return this.boutiquesService.overview(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.boutiquesService.findOne(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBoutiqueDto) {
    return this.boutiquesService.update(id, dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeBoutiqueStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.boutiquesService.changeStatus(id, dto, actor);
  }
}
