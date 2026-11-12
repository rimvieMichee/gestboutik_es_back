import { Injectable, UnauthorizedException } from '@nestjs/common';
import { BoutiqueStatus, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthCacheService } from './auth-cache.service';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/**
 * Vérifie qu'un compte (et sa boutique) est toujours actif. Partagé par la
 * stratégie JWT des requêtes HTTP et par la connexion temps réel (websocket) :
 * une désactivation coupe donc les deux de la même manière.
 */
@Injectable()
export class AuthValidatorService {
  constructor(
    private prisma: PrismaService,
    private authCache: AuthCacheService,
  ) {}

  async validate(userId: string): Promise<AuthenticatedUser> {
    // L'état est revérifié en base, mais mémorisé quelques secondes et invalidé
    // dès qu'un statut change (voir AuthCacheService).
    const cached = this.authCache.get(userId);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        statut: true,
        boutiqueId: true,
        boutique: { select: { statut: true } },
      },
    });

    if (!user || user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte désactivé ou introuvable.');
    }
    if (user.role !== Role.SUPER_ADMIN) {
      if (!user.boutique || user.boutique.statut !== BoutiqueStatus.ACTIVE) {
        throw new UnauthorizedException('Boutique désactivée.');
      }
    }

    const authenticated: AuthenticatedUser = {
      userId: user.id,
      username: user.username,
      role: user.role,
      boutiqueId: user.boutiqueId,
    };
    this.authCache.set(user.id, authenticated);
    return authenticated;
  }
}
