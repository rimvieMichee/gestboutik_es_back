import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Salons (rooms) Socket.IO : qui reçoit quoi. */
export const Rooms = {
  /** Tous les comptes d'une boutique (gestionnaire + employés) : stock, produits. */
  boutique: (id: string) => `boutique:${id}`,
  /** Gestionnaires d'une boutique : toutes les ventes de la boutique. */
  managers: (id: string) => `boutique:${id}:managers`,
  /** Un compte précis : ses propres ventes (employé). */
  user: (id: string) => `user:${id}`,
  /** Technicien : tout ce qui se passe sur la plateforme. */
  platform: 'platform',
} as const;

export interface SaleEvent {
  saleId: string;
  numeroVente: string;
  montantTotal: number;
  isCredit: boolean;
  clientNom?: string | null;
  boutiqueId: string;
  /** Employé qui a réalisé la vente. */
  userId: string;
  createdAt: Date;
}

/**
 * Diffuse les changements en temps réel (stock, ventes, crédits, activité).
 * Les émissions sont « fire and forget » : un échec de diffusion ne doit jamais
 * faire échouer l'opération métier déjà validée en base.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Server;

  attach(server: Server): void {
    this.server = server;
  }

  private emit(rooms: string[], event: string, payload: unknown): void {
    try {
      this.server?.to(rooms).emit(event, payload);
    } catch (error) {
      this.logger.warn(`Diffusion « ${event} » impossible : ${String(error)}`);
    }
  }

  /** Nouvelle quantité d'un produit : appliquée directement par les écrans. */
  stockUpdated(
    boutiqueId: string,
    product: { id: string; quantiteDisponible: number; statut?: string },
  ): void {
    this.emit([Rooms.boutique(boutiqueId), Rooms.platform], 'stock.updated', {
      productId: product.id,
      boutiqueId,
      quantiteDisponible: product.quantiteDisponible,
      statut: product.statut,
    });
  }

  /** Produit créé, modifié, archivé ou restauré : les listes se rechargent. */
  productChanged(
    boutiqueId: string,
    productId: string,
    change: 'created' | 'updated' | 'archived' | 'restored',
  ): void {
    this.emit([Rooms.boutique(boutiqueId), Rooms.platform], 'product.changed', {
      productId,
      boutiqueId,
      change,
    });
  }

  /** Vente : gestionnaires de la boutique, employé vendeur et technicien. */
  saleCreated(sale: SaleEvent): void {
    this.emit(
      [
        Rooms.managers(sale.boutiqueId),
        Rooms.user(sale.userId),
        Rooms.platform,
      ],
      'sale.created',
      sale,
    );
  }

  creditSettled(sale: SaleEvent): void {
    this.emit(
      [
        Rooms.managers(sale.boutiqueId),
        Rooms.user(sale.userId),
        Rooms.platform,
      ],
      'credit.settled',
      sale,
    );
  }

  /** Événement du journal d'activité (technicien uniquement). */
  activity(action: string, boutiqueId?: string | null): void {
    this.emit([Rooms.platform], 'activity', {
      action,
      boutiqueId: boutiqueId ?? null,
      createdAt: new Date(),
    });
  }

  /** Coupe les connexions temps réel d'un compte (désactivation, mot de passe réinitialisé). */
  disconnectUser(userId: string): void {
    this.server?.in(Rooms.user(userId)).disconnectSockets(true);
  }

  /** Coupe toutes les connexions d'une boutique (boutique désactivée). */
  disconnectBoutique(boutiqueId: string): void {
    this.server?.in(Rooms.boutique(boutiqueId)).disconnectSockets(true);
  }
}
