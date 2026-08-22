import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

/** Rôles rattachés à une boutique unique (par opposition au SUPER_ADMIN, qui n'en a pas). */
function isBoutiqueScoped(user: AuthenticatedUser): boolean {
  return user.role !== Role.SUPER_ADMIN;
}

/**
 * Détermine le boutiqueId sur lequel filtrer une requête.
 * - ADMIN / EMPLOYEE : toujours forcé à sa propre boutique, quoi que le client envoie.
 * - SUPER_ADMIN : peut cibler n'importe quelle boutique (ou aucune = vue globale).
 * C'est la seule source de vérité pour l'isolation multi-tenant côté backend.
 */
export function resolveBoutiqueScope(
  user: AuthenticatedUser,
  requestedBoutiqueId?: string | null,
): string | undefined {
  if (isBoutiqueScoped(user)) {
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

/** Vérifie qu'un ADMIN/EMPLOYEE n'accède qu'à sa propre boutique ; ne restreint pas le SUPER_ADMIN. */
export function assertSameBoutique(
  user: AuthenticatedUser,
  resourceBoutiqueId: string,
): void {
  if (isBoutiqueScoped(user) && user.boutiqueId !== resourceBoutiqueId) {
    throw new ForbiddenException(
      "Accès refusé aux données d'une autre boutique.",
    );
  }
}
