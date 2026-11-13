import { Injectable, UnauthorizedException } from '@nestjs/common';
import { BoutiqueStatus, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthCacheService, type CachedAccount } from './auth-cache.service';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/**
 * Choisit la boutique active d'une session. Un gestionnaire peut en gérer
 * plusieurs : la session garde celle de son jeton tant qu'elle est gérée et
 * active ; sinon (ouverture de session, boutique désactivée) on retombe sur sa
 * boutique par défaut, puis sur la première boutique active.
 */
export function pickActiveBoutique(
  memberships: Array<{ id: string; actif: boolean }>,
  preferred?: string | null,
  fallback?: string | null,
): string | null {
  const active = memberships.filter((m) => m.actif);
  for (const wanted of [preferred, fallback]) {
    if (wanted && active.some((m) => m.id === wanted)) return wanted;
  }
  return active[0]?.id ?? null;
}

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

  /** @param tokenBoutiqueId boutique active portée par le jeton de la session. */
  async validate(
    userId: string,
    tokenBoutiqueId?: string | null,
  ): Promise<AuthenticatedUser> {
    const account = await this.loadAccount(userId);

    if (account.role === Role.SUPER_ADMIN) {
      return {
        userId: account.userId,
        username: account.username,
        role: account.role,
        boutiqueId: null,
      };
    }

    if (account.role === Role.ADMIN) {
      const known = account.memberships.find((m) => m.id === tokenBoutiqueId);
      if (tokenBoutiqueId && !known) {
        // Boutique retirée à ce gestionnaire depuis l'émission du jeton.
        throw new UnauthorizedException("Cette boutique n'est plus accessible.");
      }
      const boutiqueId =
        tokenBoutiqueId ??
        pickActiveBoutique(account.memberships, account.defaultBoutiqueId);
      const current = account.memberships.find((m) => m.id === boutiqueId);
      if (!boutiqueId || !current?.actif) {
        throw new UnauthorizedException('Boutique désactivée.');
      }
      return {
        userId: account.userId,
        username: account.username,
        role: account.role,
        boutiqueId,
        boutiqueIds: account.memberships.filter((m) => m.actif).map((m) => m.id),
      };
    }

    // EMPLOYEE : une seule boutique, celle de son compte.
    if (!account.defaultBoutiqueId || !account.ownBoutiqueActive) {
      throw new UnauthorizedException('Boutique désactivée.');
    }
    return {
      userId: account.userId,
      username: account.username,
      role: account.role,
      boutiqueId: account.defaultBoutiqueId,
    };
  }

  private async loadAccount(userId: string): Promise<CachedAccount> {
    // L'état est revérifié en base, mais mémorisé quelques secondes et invalidé
    // dès qu'un statut ou un rattachement change (voir AuthCacheService).
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
        boutiques: {
          select: { boutiqueId: true, boutique: { select: { statut: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user || user.statut !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Compte désactivé ou introuvable.');
    }

    const account: CachedAccount = {
      userId: user.id,
      username: user.username,
      role: user.role,
      defaultBoutiqueId: user.boutiqueId,
      memberships: [
        ...user.boutiques.map((m) => ({
          id: m.boutiqueId,
          actif: m.boutique.statut === BoutiqueStatus.ACTIVE,
        })),
        // Compte antérieur au rattachement multiple : sa boutique reste gérée.
        ...(user.role === Role.ADMIN &&
        user.boutiqueId &&
        user.boutique &&
        !user.boutiques.some((m) => m.boutiqueId === user.boutiqueId)
          ? [
              {
                id: user.boutiqueId,
                actif: user.boutique.statut === BoutiqueStatus.ACTIVE,
              },
            ]
          : []),
      ],
      ownBoutiqueActive: user.boutique?.statut === BoutiqueStatus.ACTIVE,
    };
    this.authCache.set(user.id, account);
    return account;
  }
}
