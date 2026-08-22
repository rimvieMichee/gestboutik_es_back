import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await bcrypt.hash('Admin123!', 12);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      nom: 'Admin',
      prenom: 'Plateforme',
      username: 'admin',
      passwordHash: adminPasswordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  const boutique = await prisma.boutique.upsert({
    where: { id: 'seed-boutique-1' },
    update: {},
    create: {
      id: 'seed-boutique-1',
      nom: 'Boutique Centrale',
      description: 'Boutique de démonstration',
      telephone: '+22670000000',
      ville: 'Ouagadougou',
      adresse: 'Avenue Kwame Nkrumah',
    },
  });

  const employeePasswordHash = await bcrypt.hash('Employee123!', 12);
  await prisma.user.upsert({
    where: { username: 'employe1' },
    update: {},
    create: {
      nom: 'Kaboré',
      prenom: 'Awa',
      username: 'employe1',
      passwordHash: employeePasswordHash,
      role: Role.EMPLOYEE,
      boutiqueId: boutique.id,
    },
  });

  await prisma.product.upsert({
    where: { boutiqueId_sku: { boutiqueId: boutique.id, sku: 'PROD-A' } },
    update: {},
    create: {
      nom: 'Produit A',
      sku: 'PROD-A',
      prixVente: 1500,
      prixAchat: 1000,
      quantiteDisponible: 50,
      seuilAlerte: 5,
      boutiqueId: boutique.id,
    },
  });

  await prisma.product.upsert({
    where: { boutiqueId_sku: { boutiqueId: boutique.id, sku: 'PROD-B' } },
    update: {},
    create: {
      nom: 'Produit B',
      sku: 'PROD-B',
      prixVente: 2500,
      prixAchat: 1800,
      quantiteDisponible: 30,
      seuilAlerte: 5,
      boutiqueId: boutique.id,
    },
  });

  console.log('Seed terminé : admin/Admin123! et employe1/Employee123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
