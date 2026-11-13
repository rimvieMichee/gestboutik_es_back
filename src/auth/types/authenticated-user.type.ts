import { Role } from '@prisma/client';

// Contenu utile décodé du JWT, attaché à `request.user` par la JwtStrategy.
export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: Role;
  /** Boutique active de cette session (celle du jeton pour un gestionnaire). */
  boutiqueId: string | null;
  /** Boutiques actives gérées par ce gestionnaire (ADMIN), dont la boutique active. */
  boutiqueIds?: string[];
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
  boutiqueId: string | null;
}
