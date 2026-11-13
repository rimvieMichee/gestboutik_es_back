import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, SaleStatus, UserStatus } from '@prisma/client';
import { hashPassword } from '../common/utils/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthCacheService } from '../auth/auth-cache.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangeUserStatusDto } from './dto/change-status.dto';
import { SetUserBoutiquesDto } from './dto/set-user-boutiques.dto';
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
  // Boutiques gérées (gestionnaires) : voir shape().
  boutiques: {
    select: {
      boutique: { select: { id: true, nom: true, ville: true, statut: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof SAFE_SELECT }>;

/** Aplatit les rattachements : `boutiques` devient une liste de boutiques. */
function shape(user: UserRow) {
  return {
    ...user,
    boutiques: user.boutiques.map((m) => m.boutique),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private authCache: AuthCacheService,
    private realtime: RealtimeService,
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
    // Boutiques gérées par le nouveau compte (plusieurs possibles pour un ADMIN).
    let boutiqueIds: string[];

    if (actor.role === Role.SUPER_ADMIN) {
      role = Role.ADMIN;
      boutiqueIds = Array.from(
        new Set([dto.boutiqueId, ...(dto.boutiqueIds ?? [])].filter(Boolean)),
      ) as string[];
      if (!boutiqueIds.length) {
        throw new BadRequestException(
          'Un ADMIN doit être rattaché à une boutique.',
        );
      }
      boutiqueId = boutiqueIds[0];
    } else if (actor.role === Role.ADMIN) {
      if (!actor.boutiqueId) {
        throw new ForbiddenException(
          "Aucune boutique n'est associée à ce compte.",
        );
      }
      role = Role.EMPLOYEE;
      boutiqueId = actor.boutiqueId;
      boutiqueIds = [boutiqueId];
    } else {
      throw new ForbiddenException('Action non autorisée.');
    }

    // Vérifications et hachage en parallèle : trois attentes au lieu de les enchaîner.
    const [existing, boutiquesFound, passwordHash] = await Promise.all([
      this.prisma.user.findUnique({ where: { username: dto.username } }),
      this.prisma.boutique.count({ where: { id: { in: boutiqueIds } } }),
      hashPassword(dto.password),
    ]);
    if (existing) {
      throw new ConflictException('Ce nom d’utilisateur est déjà utilisé.');
    }
    if (boutiquesFound !== boutiqueIds.length) {
      throw new NotFoundException('Boutique introuvable.');
    }

    const created = await this.prisma.user.create({
      data: {
        // Ajout rapide : à défaut de nom/prénom, on retombe sur l'identifiant
        // (modifiable ensuite via la fiche du compte).
        nom: dto.nom?.trim() || dto.username,
        prenom: dto.prenom?.trim() || '',
        telephone: dto.telephone,
        email: dto.email,
        username: dto.username,
        passwordHash,
        role,
        boutiqueId,
        ...(role === Role.ADMIN
          ? {
              boutiques: {
                create: boutiqueIds.map((id) => ({ boutiqueId: id })),
              },
            }
          : {}),
      },
      select: SAFE_SELECT,
    });
    await this.auditService.record({
      action: 'USER_CREATED',
      entity: 'User',
      entityId: created.id,
      userId: actor.userId,
      boutiqueId,
      metadata: { username: created.username, role },
    });
    return shape(created);
  }

  /**
   * Le technicien choisit les boutiques qu'un gestionnaire peut ouvrir. La
   * boutique par défaut reste la sienne tant qu'elle fait partie de la liste.
   */
  async setBoutiques(
    actor: AuthenticatedUser,
    id: string,
    dto: SetUserBoutiquesDto,
  ) {
    const target = await this.findOne(id);
    this.assertCanManage(actor, target);

    const ids = Array.from(new Set(dto.boutiqueIds));
    const found = await this.prisma.boutique.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new NotFoundException('Boutique introuvable.');
    }

    await this.prisma.$transaction([
      this.prisma.userBoutique.deleteMany({
        where: { userId: id, boutiqueId: { notIn: ids } },
      }),
      this.prisma.userBoutique.createMany({
        data: ids.map((boutiqueId) => ({ userId: id, boutiqueId })),
        skipDuplicates: true,
      }),
      this.prisma.user.update({
        where: { id },
        data: {
          boutiqueId:
            target.boutiqueId && ids.includes(target.boutiqueId)
              ? target.boutiqueId
              : ids[0],
        },
      }),
    ]);
    // Les sessions ouvertes sur une boutique retirée doivent le savoir tout de suite.
    this.authCache.invalidateUser(id);
    this.realtime.disconnectUser(id);

    await this.auditService.record({
      action: 'USER_BOUTIQUES_CHANGED',
      entity: 'User',
      entityId: id,
      userId: actor.userId,
      metadata: { boutiqueIds: ids },
    });
    return this.findOne(id);
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
        ...(query.boutiqueId
          ? { boutiques: { some: { boutiqueId: query.boutiqueId } } }
          : {}),
      };
    } else if (actor.role === Role.ADMIN) {
      where = { role: Role.EMPLOYEE, boutiqueId: actor.boutiqueId };
    } else {
      throw new ForbiddenException('Action non autorisée.');
    }

    if (query.statut) {
      where.statut = query.statut;
    }
    if (query.search) {
      where.OR = [
        { nom: { contains: query.search, mode: 'insensitive' } },
        { prenom: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Le technicien suit aussi la dernière connexion de chaque gestionnaire.
    const rows = data.map(shape);
    let enriched: Array<
      (typeof rows)[number] & { derniereConnexion?: Date | null }
    > = rows;
    if (actor.role === Role.SUPER_ADMIN && data.length) {
      const logins = await this.prisma.auditLog.groupBy({
        by: ['userId'],
        where: {
          action: 'USER_LOGIN',
          userId: { in: data.map((u) => u.id) },
        },
        _max: { createdAt: true },
      });
      const lastLogin = new Map(
        logins.map((l) => [l.userId, l._max.createdAt]),
      );
      enriched = rows.map((u) => ({
        ...u,
        derniereConnexion: lastLogin.get(u.id) ?? null,
      }));
    }

    return { data: enriched, meta: buildPaginationMeta(page, limit, total) };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { telephone: dto.telephone?.trim() || null },
      select: SAFE_SELECT,
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SAFE_SELECT,
    });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return shape(user);
  }

  async findOneManaged(actor: AuthenticatedUser, id: string) {
    const user = await this.findOne(id);
    this.assertCanManage(actor, user);
    return user;
  }

  /** Activité d'un employé géré par l'acteur : ventes totales et du jour, chiffre d'affaires. */
  async getStats(actor: AuthenticatedUser, id: string) {
    await this.findOneManaged(actor, id);

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const base = { userId: id, statut: SaleStatus.COMPLETED };

    const [total, today, last] = await Promise.all([
      this.prisma.sale.aggregate({
        where: base,
        _count: { _all: true },
        _sum: { montantTotal: true },
      }),
      this.prisma.sale.aggregate({
        where: { ...base, createdAt: { gte: startOfDay } },
        _count: { _all: true },
        _sum: { montantTotal: true },
      }),
      this.prisma.sale.findFirst({
        where: base,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      nombreVentes: total._count._all,
      chiffreAffaires: total._sum.montantTotal ?? 0,
      ventesDuJour: today._count._all,
      chiffreAffairesDuJour: today._sum.montantTotal ?? 0,
      derniereVente: last?.createdAt ?? null,
    };
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateUserDto) {
    const target = await this.findOne(id);
    this.assertCanManage(actor, target);

    const updated = await this.prisma.user.update({
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
    return shape(updated);
  }

  async changeStatus(
    id: string,
    dto: ChangeUserStatusDto,
    actor: AuthenticatedUser,
  ) {
    const target = await this.findOne(id);
    this.assertCanManage(actor, target);
    const row = await this.prisma.user.update({
      where: { id },
      data: { statut: dto.statut },
      select: SAFE_SELECT,
    });
    const user = shape(row);

    // Le changement doit être effectif tout de suite, sans attendre le cache.
    this.authCache.invalidateUser(id);
    if (dto.statut === UserStatus.INACTIVE) {
      this.realtime.disconnectUser(id);
    }

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
    const passwordHash = await hashPassword(dto.password);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revoked: false },
      data: { revoked: true },
    });
    await this.auditService.record({
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: id,
      userId: actor.userId,
      boutiqueId: target.boutiqueId,
      metadata: { username: target.username },
    });
    // Ses appareils doivent se reconnecter avec le nouveau mot de passe.
    this.realtime.disconnectUser(id);
    return { success: true };
  }
}
