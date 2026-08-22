import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { CreateBoutiqueDto } from './dto/create-boutique.dto';
import { UpdateBoutiqueDto } from './dto/update-boutique.dto';
import { ChangeBoutiqueStatusDto } from './dto/change-status.dto';

@Injectable()
export class BoutiquesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async create(dto: CreateBoutiqueDto) {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.adminUsername },
    });
    if (existing) {
      throw new ConflictException(
        'Ce nom d’utilisateur (admin) est déjà utilisé.',
      );
    }

    const adminPasswordHash = await bcrypt.hash(dto.adminPassword, 12);

    return this.prisma.$transaction(async (tx) => {
      const boutique = await tx.boutique.create({
        data: {
          nom: dto.nom,
          description: dto.description,
          telephone: dto.telephone,
          email: dto.email,
          adresse: dto.adresse,
          ville: dto.ville,
        },
      });

      const admin = await tx.user.create({
        data: {
          nom: dto.adminNom,
          prenom: dto.adminPrenom,
          username: dto.adminUsername,
          passwordHash: adminPasswordHash,
          role: Role.ADMIN,
          boutiqueId: boutique.id,
        },
        select: { id: true, nom: true, prenom: true, username: true },
      });

      return { ...boutique, admin };
    });
  }

  async findAll(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.BoutiqueWhereInput = query.search
      ? {
          OR: [
            { nom: { contains: query.search, mode: 'insensitive' } },
            { ville: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.boutique.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      }),
      this.prisma.boutique.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const boutique = await this.prisma.boutique.findUnique({ where: { id } });
    if (!boutique) {
      throw new NotFoundException('Boutique introuvable.');
    }
    return boutique;
  }

  async update(id: string, dto: UpdateBoutiqueDto) {
    await this.findOne(id);
    return this.prisma.boutique.update({ where: { id }, data: dto });
  }

  async changeStatus(
    id: string,
    dto: ChangeBoutiqueStatusDto,
    actor: AuthenticatedUser,
  ) {
    await this.findOne(id);
    const boutique = await this.prisma.boutique.update({
      where: { id },
      data: { statut: dto.statut },
    });
    await this.auditService.record({
      action: 'BOUTIQUE_STATUS_CHANGED',
      entity: 'Boutique',
      entityId: id,
      userId: actor.userId,
      boutiqueId: id,
      metadata: { statut: dto.statut },
    });
    return boutique;
  }
}
