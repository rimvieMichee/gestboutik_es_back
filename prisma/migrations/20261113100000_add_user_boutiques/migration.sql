-- Un gestionnaire peut gérer plusieurs boutiques.
CREATE TABLE "user_boutiques" (
    "userId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_boutiques_pkey" PRIMARY KEY ("userId","boutiqueId")
);

-- CreateIndex
CREATE INDEX "user_boutiques_boutiqueId_idx" ON "user_boutiques"("boutiqueId");

-- AddForeignKey
ALTER TABLE "user_boutiques" ADD CONSTRAINT "user_boutiques_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_boutiques" ADD CONSTRAINT "user_boutiques_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "boutiques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise de l'existant : chaque gestionnaire gère déjà sa boutique actuelle.
INSERT INTO "user_boutiques" ("userId", "boutiqueId")
SELECT "id", "boutiqueId" FROM "users"
WHERE "role" = 'ADMIN' AND "boutiqueId" IS NOT NULL
ON CONFLICT DO NOTHING;
