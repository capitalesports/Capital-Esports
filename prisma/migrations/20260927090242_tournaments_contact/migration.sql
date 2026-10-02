-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "bracketIndex" INTEGER,
ADD COLUMN     "bracketRound" INTEGER,
ADD COLUMN     "isEntryList" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "bracketSize" INTEGER,
ADD COLUMN     "entryMatchId" TEXT,
ADD COLUMN     "startsAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "streamUrl" TEXT,
ADD COLUMN     "winnersPublishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_handled_createdAt_idx" ON "ContactMessage"("handled", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_entryMatchId_key" ON "Tournament"("entryMatchId");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_entryMatchId_fkey" FOREIGN KEY ("entryMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

