import { Role } from '@prisma/client';

// Contenu utile décodé du JWT, attaché à `request.user` par la JwtStrategy.
export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: Role;
  boutiqueId: string | null;
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
  boutiqueId: string | null;
}
