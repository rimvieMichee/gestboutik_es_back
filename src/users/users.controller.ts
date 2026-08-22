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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeUserStatusDto } from './dto/change-status.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { QueryUserDto } from './dto/query-user.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // Profil de l'utilisateur connecté (employé ou admin).
  @Get('me')
  findMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findOne(user.userId);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(actor, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: QueryUserDto,
  ) {
    return this.usersService.findAll(actor, query);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Get(':id')
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.findOneManaged(actor, id);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(actor, id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.changeStatus(id, dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Patch(':id/password')
  resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.usersService.resetPassword(actor, id, dto);
  }
}
