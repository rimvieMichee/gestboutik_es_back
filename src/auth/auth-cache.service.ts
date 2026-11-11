import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/**
 * Mémorise quelques secondes l'état « compte et boutique actifs » vérifié à
 * chaque requête authentifiée. Sans cela, chaque appel coûtait plusieurs
 * allers-retours vers la base avant même de traiter la demande.
 *
 * Une désactivation reste immédiate : les services qui modifient le statut d'un
 * compte ou d'une boutique invalident l'entrée concernée (voir
 * UsersService.changeStatus et BoutiquesService.changeStatus). La durée de vie
 * ne sert que de filet de sécurité, par exemple si plusieurs instances tournent.
 */
@Injectable()
export class AuthCacheService {
  private static readonly TTL_MS = 30_000;
  private readonly entries = new Map<
    string,
    { user: AuthenticatedUser; expiresAt: number }
  >();

  get(userId: string): AuthenticatedUser | undefined {
    const entry = this.entries.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(userId);
      return undefined;
    }
    return entry.user;
  }

  set(userId: string, user: AuthenticatedUser): void {
    this.entries.set(userId, {
      user,
      expiresAt: Date.now() + AuthCacheService.TTL_MS,
    });
  }

  invalidateUser(userId: string): void {
    this.entries.delete(userId);
  }

  /** Statut d'une boutique modifié : tous ses comptes sont à revérifier. */
  clear(): void {
    this.entries.clear();
  }
}
