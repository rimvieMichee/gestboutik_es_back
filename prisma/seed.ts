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

  await prisma.user.upsert({
    where: { username: 'admin2' },
    update: {},
    create: {
      nom: 'Admin',
      prenom: 'Secondaire',
      username: 'admin2',
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

  const boutique1Products: Array<{
    nom: string;
    sku: string;
    prixVente: number;
    prixAchat: number;
    quantiteDisponible: number;
    seuilAlerte: number;
  }> = [
    { nom: 'Produit A', sku: 'PROD-A', prixVente: 1500, prixAchat: 1000, quantiteDisponible: 50, seuilAlerte: 5 },
    { nom: 'Produit B', sku: 'PROD-B', prixVente: 2500, prixAchat: 1800, quantiteDisponible: 30, seuilAlerte: 5 },
    { nom: 'Produit C (stock bas)', sku: 'PROD-C', prixVente: 1000, prixAchat: 700, quantiteDisponible: 3, seuilAlerte: 5 },
    { nom: 'Produit D (rupture)', sku: 'PROD-D', prixVente: 3000, prixAchat: 2200, quantiteDisponible: 0, seuilAlerte: 5 },
  ];
  for (const p of boutique1Products) {
    await prisma.product.upsert({
      where: { boutiqueId_sku: { boutiqueId: boutique.id, sku: p.sku } },
      update: {},
      create: { ...p, boutiqueId: boutique.id },
    });
  }

  // Deuxième boutique + employé, pour tester l'isolation multi-tenant
  // (un employé ne doit jamais voir les données d'une autre boutique).
  const boutique2 = await prisma.boutique.upsert({
    where: { id: 'seed-boutique-2' },
    update: {},
    create: {
      id: 'seed-boutique-2',
      nom: 'Boutique Nord',
      description: 'Deuxième boutique de démonstration',
      telephone: '+22670000001',
      ville: 'Bobo-Dioulasso',
      adresse: 'Avenue de la Révolution',
    },
  });

  const employee2PasswordHash = await bcrypt.hash('Employee123!', 12);
  await prisma.user.upsert({
    where: { username: 'employe2' },
    update: {},
    create: {
      nom: 'Sana',
      prenom: 'Boureima',
      username: 'employe2',
      passwordHash: employee2PasswordHash,
      role: Role.EMPLOYEE,
      boutiqueId: boutique2.id,
    },
  });

  const boutique2Products: Array<{
    nom: string;
    sku: string;
    prixVente: number;
    prixAchat: number;
    quantiteDisponible: number;
    seuilAlerte: number;
  }> = [
    { nom: 'Produit E', sku: 'PROD-E', prixVente: 1200, prixAchat: 800, quantiteDisponible: 40, seuilAlerte: 5 },
    { nom: 'Produit F (stock bas)', sku: 'PROD-F', prixVente: 1800, prixAchat: 1300, quantiteDisponible: 2, seuilAlerte: 5 },
    { nom: 'Produit G (rupture)', sku: 'PROD-G', prixVente: 900, prixAchat: 600, quantiteDisponible: 0, seuilAlerte: 5 },
  ];
  for (const p of boutique2Products) {
    await prisma.product.upsert({
      where: { boutiqueId_sku: { boutiqueId: boutique2.id, sku: p.sku } },
      update: {},
      create: { ...p, boutiqueId: boutique2.id },
    });
  }

  console.log(
    'Seed terminé : admin/Admin123!, admin2/Admin123! (SUPER_ADMIN), employe1/Employee123! (Boutique Centrale), employe2/Employee123! (Boutique Nord)',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
