import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Flux critiques (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let boutiqueA: { id: string };
  let boutiqueB: { id: string };
  let productA: { id: string };
  let productB: { id: string };
  let adminAccess: string;
  let boutiqueAdminAAccess: string;
  let employeeAAccess: string;
  let employeeAId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Nettoyage complet de la base de test avant de poser les fixtures.
    await prisma.auditLog.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.saleItem.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.boutique.deleteMany();

    boutiqueA = await prisma.boutique.create({
      data: { nom: 'Boutique A', ville: 'Ouaga' },
    });
    boutiqueB = await prisma.boutique.create({
      data: { nom: 'Boutique B', ville: 'Bobo' },
    });

    productA = await prisma.product.create({
      data: {
        nom: 'Produit A',
        prixVente: 1500,
        quantiteDisponible: 10,
        boutiqueId: boutiqueA.id,
      },
    });
    productB = await prisma.product.create({
      data: {
        nom: 'Produit B',
        prixVente: 2500,
        quantiteDisponible: 5,
        boutiqueId: boutiqueB.id,
      },
    });

    const passwordHash = await bcrypt.hash('Passw0rd!', 4);
    await prisma.user.create({
      data: {
        nom: 'Admin',
        prenom: 'Test',
        username: 'e2e-admin',
        passwordHash,
        role: Role.SUPER_ADMIN,
      },
    });
    const employeeA = await prisma.user.create({
      data: {
        nom: 'Employe',
        prenom: 'A',
        username: 'e2e-emp-a',
        passwordHash,
        role: Role.EMPLOYEE,
        boutiqueId: boutiqueA.id,
      },
    });
    await prisma.user.create({
      data: {
        nom: 'Employe',
        prenom: 'B',
        username: 'e2e-emp-b',
        passwordHash,
        role: Role.EMPLOYEE,
        boutiqueId: boutiqueB.id,
      },
    });
    const boutiqueAdminA = await prisma.user.create({
      data: {
        nom: 'Admin',
        prenom: 'BoutiqueA',
        username: 'e2e-boutique-admin-a',
        passwordHash,
        role: Role.ADMIN,
        boutiqueId: boutiqueA.id,
      },
    });
    employeeAId = employeeA.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'e2e-admin', password: 'Passw0rd!' });
    adminAccess = adminLogin.body.accessToken;

    // Le login HTTP est throttlé (5/min) : on signe directement ce token de
    // test via JwtService plutôt que de consommer un appel supplémentaire à
    // /auth/login, pour ne pas rendre les autres tests de login flaky.
    const jwtService = app.get(JwtService);
    const config = app.get(ConfigService);
    boutiqueAdminAAccess = await jwtService.signAsync(
      {
        sub: boutiqueAdminA.id,
        username: boutiqueAdminA.username,
        role: boutiqueAdminA.role,
        boutiqueId: boutiqueAdminA.boutiqueId,
      },
      {
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN'),
      },
    );

    const employeeALogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'e2e-emp-a', password: 'Passw0rd!' });
    employeeAAccess = employeeALogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentification', () => {
    it('refuse un mauvais mot de passe', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'e2e-emp-a', password: 'mauvais-mdp' });
      expect(res.status).toBe(401);
    });

    it('refuse une route protégée sans token', async () => {
      const res = await request(app.getHttpServer()).get('/api/products');
      expect(res.status).toBe(401);
    });
  });

  describe('Permissions par rôle', () => {
    it("refuse à un EMPLOYEE l'accès au dashboard admin", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/dashboard/overview')
        .set('Authorization', `Bearer ${employeeAAccess}`);
      expect(res.status).toBe(403);
    });

    it("refuse à un EMPLOYEE la création d'une boutique", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/boutiques')
        .set('Authorization', `Bearer ${employeeAAccess}`)
        .send({ nom: 'Tentative interdite' });
      expect(res.status).toBe(403);
    });
  });

  describe('Isolation multi-boutique', () => {
    it("empêche un employé de consulter un produit d'une autre boutique", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/products/${productB.id}`)
        .set('Authorization', `Bearer ${employeeAAccess}`);
      expect(res.status).toBe(403);
    });

    it("empêche un employé d'acheter un produit d'une autre boutique", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales')
        .set('Authorization', `Bearer ${employeeAAccess}`)
        .send({ items: [{ productId: productB.id, quantite: 1 }] });
      expect(res.status).toBe(403);
    });

    it('ne renvoie que les produits de la boutique du token, quel que soit le filtre demandé', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/products?boutiqueId=${boutiqueB.id}`)
        .set('Authorization', `Bearer ${employeeAAccess}`);
      expect(res.status).toBe(403);
    });
  });

  describe('Création de vente', () => {
    it('recalcule le total côté serveur (le DTO ne permet même pas d’envoyer un prix)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales')
        .set('Authorization', `Bearer ${employeeAAccess}`)
        .send({ items: [{ productId: productA.id, quantite: 2 }] });

      expect(res.status).toBe(201);
      expect(res.body.montantTotal).toBe('3000');
      expect(res.body.items[0].prixUnitaire).toBe('1500');
    });

    it('rejette un prix/total envoyé par le client (DTO whitelist)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales')
        .set('Authorization', `Bearer ${employeeAAccess}`)
        .send({
          items: [
            { productId: productA.id, quantite: 1, prixUnitaire: 999999 },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('diminue le stock du produit vendu', async () => {
      const product = await prisma.product.findUnique({
        where: { id: productA.id },
      });
      expect(product?.quantiteDisponible).toBe(8);
    });

    it('refuse une vente si le stock est insuffisant', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales')
        .set('Authorization', `Bearer ${employeeAAccess}`)
        .send({ items: [{ productId: productA.id, quantite: 1000 }] });
      expect(res.status).toBe(400);

      const product = await prisma.product.findUnique({
        where: { id: productA.id },
      });
      expect(product?.quantiteDisponible).toBe(8);
    });

    it('un employé ne peut consulter que ses propres ventes', async () => {
      const employeeBLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'e2e-emp-b', password: 'Passw0rd!' });

      const listAsA = await request(app.getHttpServer())
        .get('/api/sales')
        .set('Authorization', `Bearer ${employeeAAccess}`);
      expect(listAsA.body.data.length).toBeGreaterThan(0);

      const listAsB = await request(app.getHttpServer())
        .get('/api/sales')
        .set('Authorization', `Bearer ${employeeBLogin.body.accessToken}`);
      expect(listAsB.body.data.length).toBe(0);
    });
  });

  describe('Rôle ADMIN (gestion des employés de sa boutique)', () => {
    it("un SUPER_ADMIN ne peut plus gérer directement un EMPLOYEE (c'est le rôle de l'ADMIN de boutique)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/users/${employeeAId}/status`)
        .set('Authorization', `Bearer ${adminAccess}`)
        .send({ statut: 'INACTIVE' });
      expect(res.status).toBe(403);
    });

    it("un ADMIN ne peut pas gérer l'employé d'une autre boutique", async () => {
      const employeeB = await prisma.user.findUniqueOrThrow({
        where: { username: 'e2e-emp-b' },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/users/${employeeB.id}/status`)
        .set('Authorization', `Bearer ${boutiqueAdminAAccess}`)
        .send({ statut: 'INACTIVE' });
      expect(res.status).toBe(403);
    });

    it('un ADMIN ne peut créer un employé que pour SA boutique, quel que soit le boutiqueId envoyé', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${boutiqueAdminAAccess}`)
        .send({
          nom: 'Nouvel',
          prenom: 'Employe',
          username: 'e2e-new-emp',
          password: 'Passw0rd!',
          boutiqueId: boutiqueB.id,
        });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('EMPLOYEE');
      expect(res.body.boutiqueId).toBe(boutiqueA.id);
    });
  });

  describe('Désactivation', () => {
    it("désactiver l'employé (par l'ADMIN de sa boutique) révoque immédiatement son accès, même avec un token encore valide", async () => {
      const before = await request(app.getHttpServer())
        .get('/api/products')
        .set('Authorization', `Bearer ${employeeAAccess}`);
      expect(before.status).toBe(200);

      await request(app.getHttpServer())
        .patch(`/api/users/${employeeAId}/status`)
        .set('Authorization', `Bearer ${boutiqueAdminAAccess}`)
        .send({ statut: 'INACTIVE' });

      const after = await request(app.getHttpServer())
        .get('/api/products')
        .set('Authorization', `Bearer ${employeeAAccess}`);
      expect(after.status).toBe(401);

      await request(app.getHttpServer())
        .patch(`/api/users/${employeeAId}/status`)
        .set('Authorization', `Bearer ${boutiqueAdminAAccess}`)
        .send({ statut: 'ACTIVE' });
    });

    it('désactiver la boutique bloque la connexion de son employé', async () => {
      await request(app.getHttpServer())
        .patch(`/api/boutiques/${boutiqueA.id}/status`)
        .set('Authorization', `Bearer ${adminAccess}`)
        .send({ statut: 'INACTIVE' });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'e2e-emp-a', password: 'Passw0rd!' });
      expect(res.status).toBe(401);

      await request(app.getHttpServer())
        .patch(`/api/boutiques/${boutiqueA.id}/status`)
        .set('Authorization', `Bearer ${adminAccess}`)
        .send({ statut: 'ACTIVE' });
    });
  });
});
