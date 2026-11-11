import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, Role, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  resolveBoutiqueScope,
  assertSameBoutique,
} from '../common/utils/tenant-scope.util';
import { buildPaginationMeta } from '../common/utils/paginate.util';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ChangeProductStatusDto } from './dto/change-status.dto';
import { QueryProductDto } from './dto/query-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(actor: AuthenticatedUser, dto: CreateProductDto) {
    if (!actor.boutiqueId) {
      throw new ForbiddenException(
        "Aucune boutique n'est associée à ce compte.",
      );
    }
    const boutiqueId = actor.boutiqueId;

    const quantiteInitiale = dto.quantiteDisponible ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          nom: dto.nom,
          description: dto.description,
          prixVente: dto.prixVente,
          prixAchat: dto.prixAchat,
          quantiteDisponible: quantiteInitiale,
          seuilAlerte: dto.seuilAlerte ?? 0,
          sku: dto.sku,
          image: dto.image,
          boutiqueId,
        },
      });

      if (quantiteInitiale > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            boutiqueId: product.boutiqueId,
            type: StockMovementType.STOCK_INITIAL,
            quantite: quantiteInitiale,
            quantiteAvant: 0,
            quantiteApres: quantiteInitiale,
          },
        });
      }

      return product;
    });
  }

  async findAll(user: AuthenticatedUser, query: QueryProductDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const boutiqueId = resolveBoutiqueScope(user, query.boutiqueId);

    const where: Prisma.ProductWhereInput = {
      ...(boutiqueId ? { boutiqueId } : {}),
      // L'employé ne voit que les produits en vente : un produit archivé par le
      // gestionnaire disparaît de sa liste.
      ...(user.role === Role.EMPLOYEE
        ? { statut: ProductStatus.ACTIVE }
        : query.statut
          ? { statut: query.statut }
          : {}),
      ...(query.search
        ? {
            OR: [
              { nom: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(page, limit, total) };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Produit introuvable.');
    }
    assertSameBoutique(user, product.boutiqueId);
    return product;
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Produit introuvable.');
    }
    assertSameBoutique(actor, product.boutiqueId);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async changeStatus(
    actor: AuthenticatedUser,
    id: string,
    dto: ChangeProductStatusDto,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Produit introuvable.');
    }
    assertSameBoutique(actor, product.boutiqueId);
    return this.prisma.product.update({
      where: { id },
      data: { statut: dto.statut },
    });
  }
}
