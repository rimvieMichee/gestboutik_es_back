import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  create(dto: CreateBoutiqueDto) {
    return this.prisma.boutique.create({ data: dto });
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
