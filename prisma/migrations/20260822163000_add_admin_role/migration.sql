-- Nouveau rôle ADMIN : administrateur d'une boutique, créé par le SUPER_ADMIN
-- en même temps que la boutique, et qui gère à son tour les employés (EMPLOYEE)
-- de cette boutique.
ALTER TYPE "Role" ADD VALUE 'ADMIN';
