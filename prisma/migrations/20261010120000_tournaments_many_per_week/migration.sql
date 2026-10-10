-- DropIndex
DROP INDEX "Tournament_game_mode_weekOf_key";

-- CreateIndex
CREATE INDEX "Tournament_game_mode_weekOf_idx" ON "Tournament"("game", "mode", "weekOf");

