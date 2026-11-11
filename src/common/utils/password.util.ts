import * as bcrypt from 'bcrypt';

// 10 tours : recommandation minimale d'OWASP, et nettement plus rapide que 12 sur
// les petites instances d'hébergement (chaque tour supplémentaire double le
// temps). Les anciens mots de passe (12 tours) restent valides : bcrypt lit le
// coût dans le hash.
const ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}
