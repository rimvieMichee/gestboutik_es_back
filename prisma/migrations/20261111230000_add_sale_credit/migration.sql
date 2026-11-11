-- Ventes à crédit : nom de l'emprunteur et date de règlement (NULL = encore dû).
ALTER TABLE "sales"
  ADD COLUMN "isCredit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientNom" TEXT,
  ADD COLUMN "creditRegleAt" TIMESTAMP(3);

CREATE INDEX "sales_boutiqueId_isCredit_creditRegleAt_idx"
  ON "sales"("boutiqueId", "isCredit", "creditRegleAt");
