import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeUserStatusDto } from './dto/change-status.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { QueryUserDto } from './dto/query-user.dto';

const SAFE_SELECT = {
  id: true,
  nom: true,
  prenom: true,
  telephone: true,
  email: true,
  username: true,
  role: true,
  statut: true,
  boutiqueId: true,
  createdAt: true,
  updatedAt: true,
  boutique: { select: { id: true, nom: true, statut: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async create(dto: CreateUserDto) {
    if (dto.role === Role.SUPER_ADMIN && dto.boutiqueId) {
      throw new BadRequestException(
        'Un SUPER_ADMIN ne doit pas être rattaché à une boutique.',
      );
    }
    if (dto.role === Role.EMPLOYEE && !dto.boutiqueId) {
      throw new BadRequestException(
        'Un EMPLOYEE doit être rattaché à une boutique.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('Ce nom d’utilisateur est déjà utilisé.');
    }

    if (dto.boutiqueId) {
      const boutique = await this.prisma.boutique.findUnique({
        where: { id: dto.boutiqueId },
      });
      if (!boutique) {
        throw new NotFoundException('Boutique introuvable.');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    return this.prisma.user.create({
      data: {
        nom: dto.nom,
        prenom: dto.prenom,
        telephone: dto.telephone,
        email: dto.email,
        username: dto.username,
        passwordHash,
        role: dto.role,
        boutiqueId: dto.role === Role.EMPLOYEE ? dto.boutiqueId : null,
      },
      select: SAFE_SELECT,
    });
  }

  async findAll(query: QueryUserDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.UserWhereInput = {
      ...(query.boutiqueId ? { boutiqueId: query.boutiqueId } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { nom: { contains: query.search, mode: 'insensitive' } },
              { prenom: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SAFE_SELECT,
    });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);

    if (dto.boutiqueId) {
      const boutique = await this.prisma.boutique.findUnique({
        where: { id: dto.boutiqueId },
      });
      if (!boutique) {
        throw new NotFoundException('Boutique introuvable.');
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        nom: dto.nom,
        prenom: dto.prenom,
        telephone: dto.telephone,
        email: dto.email,
        boutiqueId: dto.boutiqueId,
      },
      select: SAFE_SELECT,
    });
  }

  async changeStatus(
    id: string,
    dto: ChangeUserStatusDto,
    actor: AuthenticatedUser,
  ) {
    const target = await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { statut: dto.statut },
      select: SAFE_SELECT,
    });

    // Toute désactivation révoque immédiatement les refresh tokens actifs.
    if (dto.statut === UserStatus.INACTIVE) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      });
    }

    await this.auditService.record({
      action: 'USER_STATUS_CHANGED',
      entity: 'User',
      entityId: id,
      userId: actor.userId,
      boutiqueId: target.boutiqueId,
      metadata: { statut: dto.statut },
    });

    return user;
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    await this.findOne(id);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revoked: false },
      data: { revoked: true },
    });
    return { success: true };
  }
}
