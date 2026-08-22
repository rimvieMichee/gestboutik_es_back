import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

  /**
   * Le rôle créé n'est jamais fourni par le client : un SUPER_ADMIN ne peut
   * créer qu'un ADMIN (rattaché à la boutique demandée), un ADMIN ne peut
   * créer qu'un EMPLOYEE, toujours rattaché à SA PROPRE boutique — jamais
   * celle envoyée par le client.
   */
  async create(actor: AuthenticatedUser, dto: CreateUserDto) {
    let role: Role;
    let boutiqueId: string;

    if (actor.role === Role.SUPER_ADMIN) {
      role = Role.ADMIN;
      if (!dto.boutiqueId) {
        throw new BadRequestException(
          'Un ADMIN doit être rattaché à une boutique.',
        );
      }
      boutiqueId = dto.boutiqueId;
    } else if (actor.role === Role.ADMIN) {
      if (!actor.boutiqueId) {
        throw new ForbiddenException(
          "Aucune boutique n'est associée à ce compte.",
        );
      }
      role = Role.EMPLOYEE;
      boutiqueId = actor.boutiqueId;
    } else {
      throw new ForbiddenException('Action non autorisée.');
    }

    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('Ce nom d’utilisateur est déjà utilisé.');
    }

    const boutique = await this.prisma.boutique.findUnique({
      where: { id: boutiqueId },
    });
    if (!boutique) {
      throw new NotFoundException('Boutique introuvable.');
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
        role,
        boutiqueId,
      },
      select: SAFE_SELECT,
    });
  }

  /**
   * Un SUPER_ADMIN ne gère que les comptes ADMIN, un ADMIN que les EMPLOYEE
   * de sa propre boutique — jamais l'inverse, jamais une autre boutique.
   */
  private assertCanManage(
    actor: AuthenticatedUser,
    target: { role: Role; boutiqueId: string | null },
  ): void {
    if (actor.role === Role.SUPER_ADMIN && target.role === Role.ADMIN) {
      return;
    }
    if (
      actor.role === Role.ADMIN &&
      target.role === Role.EMPLOYEE &&
      target.boutiqueId === actor.boutiqueId
    ) {
      return;
    }
    throw new ForbiddenException(
      'Ce compte ne peut pas être géré depuis cette action.',
    );
  }

  async findAll(actor: AuthenticatedUser, query: QueryUserDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    let where: Prisma.UserWhereInput;
    if (actor.role === Role.SUPER_ADMIN) {
      where = {
        role: Role.ADMIN,
        ...(query.boutiqueId ? { boutiqueId: query.boutiqueId } : {}),
      };
    } else if (actor.role === Role.ADMIN) {
      where = { role: Role.EMPLOYEE, boutiqueId: actor.boutiqueId };
    } else {
      throw new ForbiddenException('Action non autorisée.');
    }

    if (query.search) {
      where.OR = [
        { nom: { contains: query.search, mode: 'insensitive' } },
        { prenom: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
      ];
    }

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

  async findOneManaged(actor: AuthenticatedUser, id: string) {
    const user = await this.findOne(id);
    this.assertCanManage(actor, user);
    return user;
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateUserDto) {
    const target = await this.findOne(id);
    this.assertCanManage(actor, target);

    return this.prisma.user.update({
      where: { id },
      data: {
        nom: dto.nom,
        prenom: dto.prenom,
        telephone: dto.telephone,
        email: dto.email,
        // La boutique d'un compte géré n'est jamais réassignée depuis ce formulaire.
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
    this.assertCanManage(actor, target);
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

  async resetPassword(
    actor: AuthenticatedUser,
    id: string,
    dto: ResetPasswordDto,
  ) {
    const target = await this.findOne(id);
    this.assertCanManage(actor, target);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revoked: false },
      data: { revoked: true },
    });
    return { success: true };
  }
}
