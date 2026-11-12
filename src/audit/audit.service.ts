import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

type TransactionClient = Prisma.TransactionClient;

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  userId?: string | null;
  boutiqueId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  // `client` permet d'insérer la ligne d'audit dans la même transaction Prisma que l'action auditée,
  // afin qu'un rollback (ex: vente annulée pour stock insuffisant) annule aussi son audit log.
  record(
    entry: AuditEntry,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    const created = client.auditLog.create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        userId: entry.userId,
        boutiqueId: entry.boutiqueId,
        metadata: entry.metadata,
      },
    });
    // Hors transaction, l'écriture est déjà validée : on prévient le technicien
    // en direct. Dans une transaction, c'est à l'appelant d'émettre après le commit.
    if (client === this.prisma) {
      void created
        .then(() => this.realtime.activity(entry.action, entry.boutiqueId))
        .catch(() => undefined);
    }
    return created;
  }
}
