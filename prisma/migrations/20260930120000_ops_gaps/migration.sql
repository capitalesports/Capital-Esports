-- One tournament per game, mode and week (was per game and week).
DROP INDEX "Tournament_game_weekOf_key";
CREATE UNIQUE INDEX "Tournament_game_mode_weekOf_key" ON "Tournament"("game", "mode", "weekOf");

-- Tournament cancellation.
ALTER TABLE "Tournament" ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Auto-cancel below a minimum number of confirmed entries.
ALTER TABLE "Match" ADD COLUMN "minSlots" INTEGER NOT NULL DEFAULT 2;

-- Scrim prize payouts, manual (offline) payouts and voided payouts.
ALTER TABLE "Payout" ADD COLUMN "manualReference" TEXT,
ADD COLUMN "matchId" TEXT,
ADD COLUMN "voidReason" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Payout_userId_matchId_key" ON "Payout"("userId", "matchId");
