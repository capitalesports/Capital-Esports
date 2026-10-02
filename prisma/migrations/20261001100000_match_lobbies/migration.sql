-- Open-entry scrims split into lobbies when registration closes (extra lobbies point at the listing).
ALTER TABLE "Match" ADD COLUMN "lobbyNumber" INTEGER,
ADD COLUMN "parentMatchId" TEXT;

CREATE INDEX "Match_parentMatchId_idx" ON "Match"("parentMatchId");

ALTER TABLE "Match" ADD CONSTRAINT "Match_parentMatchId_fkey" FOREIGN KEY ("parentMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
