import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private prisma: PrismaService) {}

  // `client` permet d'insérer la ligne d'audit dans la même transaction Prisma que l'action auditée,
  // afin qu'un rollback (ex: vente annulée pour stock insuffisant) annule aussi son audit log.
  record(
    entry: AuditEntry,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    return client.auditLog.create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        userId: entry.userId,
        boutiqueId: entry.boutiqueId,
        metadata: entry.metadata,
      },
    });
  }
}
