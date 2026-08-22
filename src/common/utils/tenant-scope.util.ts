import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

/**
 * Détermine le boutiqueId sur lequel filtrer une requête.
 * - EMPLOYEE : toujours forcé à sa propre boutique, quoi que le client envoie.
 * - SUPER_ADMIN : peut cibler n'importe quelle boutique (ou aucune = vue globale).
 * C'est la seule source de vérité pour l'isolation multi-tenant côté backend.
 */
export function resolveBoutiqueScope(
  user: AuthenticatedUser,
  requestedBoutiqueId?: string | null,
): string | undefined {
  if (user.role === Role.EMPLOYEE) {
    if (!user.boutiqueId) {
      throw new ForbiddenException(
        "Aucune boutique n'est associée à ce compte.",
      );
    }
    if (requestedBoutiqueId && requestedBoutiqueId !== user.boutiqueId) {
      throw new ForbiddenException(
        "Accès refusé aux données d'une autre boutique.",
      );
    }
    return user.boutiqueId;
  }
  return requestedBoutiqueId ?? undefined;
}

/** Vérifie qu'un EMPLOYEE n'accède qu'à sa propre boutique ; ne restreint pas le SUPER_ADMIN. */
export function assertSameBoutique(
  user: AuthenticatedUser,
  resourceBoutiqueId: string,
): void {
  if (user.role === Role.EMPLOYEE && user.boutiqueId !== resourceBoutiqueId) {
    throw new ForbiddenException(
      "Accès refusé aux données d'une autre boutique.",
    );
  }
}
