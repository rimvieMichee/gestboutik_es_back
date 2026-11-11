/**
 * Remise à zéro de la base : supprime TOUTES les données (boutiques, comptes,
 * produits, ventes, mouvements de stock, journal d'audit) et ne conserve qu'un
 * compte technicien (SUPER_ADMIN).
 *
 * Irréversible. Les identifiants viennent de l'environnement (jamais écrits
 * dans le dépôt) :
 *
 *   CONFIRM_WIPE=YES TECH_LOGIN=... TECH_PASSWORD=... npx ts-node prisma/reset-to-technician.ts
 *
 * Les images déjà envoyées sur Cloudinary ne sont pas supprimées.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const login = process.env.TECH_LOGIN?.trim();
  const password = process.env.TECH_PASSWORD;
  if (process.env.CONFIRM_WIPE !== 'YES') {
    throw new Error(
      'Refusé : définir CONFIRM_WIPE=YES pour confirmer la suppression.',
    );
  }
  if (!login || !password || password.length < 8) {
    throw new Error(
      'TECH_LOGIN et TECH_PASSWORD (8 caractères minimum) sont requis.',
    );
  }

  const before = {
    boutiques: await prisma.boutique.count(),
    utilisateurs: await prisma.user.count(),
    produits: await prisma.product.count(),
    ventes: await prisma.sale.count(),
  };
  console.log('Avant :', before);

  const passwordHash = await bcrypt.hash(password, 10);

  // Ordre imposé par les clés étrangères (onDelete: Restrict).
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.stockMovement.deleteMany(),
    prisma.saleItem.deleteMany(),
    prisma.sale.deleteMany(),
    prisma.product.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.boutique.deleteMany(),
    prisma.user.create({
      data: {
        nom: 'Technicien',
        prenom: login,
        username: login,
        passwordHash,
        role: Role.SUPER_ADMIN,
      },
    }),
  ]);

  console.log('Après :', {
    boutiques: await prisma.boutique.count(),
    utilisateurs: await prisma.user.count(),
    produits: await prisma.product.count(),
    ventes: await prisma.sale.count(),
  });
  console.log(`Terminé : seul le compte technicien "${login}" subsiste.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
