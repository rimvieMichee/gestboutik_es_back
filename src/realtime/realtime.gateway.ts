import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Role } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import { AuthValidatorService } from '../auth/auth-validator.service';
import type { JwtPayload } from '../auth/types/authenticated-user.type';
import { RealtimeService, Rooms } from './realtime.service';

/**
 * Passerelle Socket.IO en lecture seule : le serveur diffuse, les clients
 * écoutent. Aucun message entrant n'est accepté (donc aucun garde HTTP à
 * contourner). L'identité vient du jeton JWT d'accès, fourni à la connexion.
 */
@WebSocketGateway({
  cors: {
    // Origines autorisées : les mêmes que pour l'API REST. Les applications
    // mobiles n'envoient pas d'en-tête Origin et passent ; elles sont de toute
    // façon authentifiées par leur jeton.
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const allowed = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      callback(null, !origin || allowed.includes(origin));
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private validator: AuthValidatorService,
    private realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth as { token?: string } | undefined;
      const header = client.handshake.headers.authorization;
      const token =
        auth?.token ??
        (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
      if (!token) throw new Error('Jeton manquant.');

      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      const user = await this.validator.validate(payload.sub, payload.boutiqueId);

      // Chaque compte n'entre que dans les salons qui lui correspondent.
      const rooms: string[] = [Rooms.user(user.userId)];
      if (user.role === Role.SUPER_ADMIN) {
        rooms.push(Rooms.platform);
      } else if (user.boutiqueId) {
        rooms.push(Rooms.boutique(user.boutiqueId));
        if (user.role === Role.ADMIN) {
          rooms.push(Rooms.managers(user.boutiqueId));
        }
      }
      await client.join(rooms);
      client.data = { userId: user.userId, role: user.role };
      client.emit('ready', { role: user.role });
    } catch (error) {
      this.logger.debug(`Connexion temps réel refusée : ${String(error)}`);
      client.emit('unauthorized');
      client.disconnect(true);
    }
  }
}
