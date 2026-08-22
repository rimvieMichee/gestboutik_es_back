-- Le numéro de vente est séquentiel par boutique (voir SalesService.create),
-- pas globalement unique : deux boutiques ont chacune leur propre compteur et
-- peuvent produire le même numéro. L'ancienne contrainte unique globale
-- provoquait une collision (500) dès qu'une deuxième boutique effectuait une vente.
DROP INDEX "sales_numeroVente_key";

CREATE UNIQUE INDEX "sales_boutiqueId_numeroVente_key" ON "sales"("boutiqueId", "numeroVente");
