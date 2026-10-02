-- The captain enters the whole roster by game ID and exact in-game name; teammates need no account.
ALTER TABLE "Registration" ADD COLUMN "teamName" TEXT;

ALTER TABLE "RegistrationMember" ADD COLUMN "gameId" TEXT,
ADD COLUMN "ign" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- One player per match (a game ID can't play for two teams in the same match).
CREATE INDEX "RegistrationMember_matchId_gameId_idx" ON "RegistrationMember"("matchId", "gameId");
