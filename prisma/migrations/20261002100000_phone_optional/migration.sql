-- Google sign-ups may have no phone (DECISIONS M31); bans can target an email.
-- AlterTable
ALTER TABLE "Ban" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Ban_email_idx" ON "Ban"("email");
