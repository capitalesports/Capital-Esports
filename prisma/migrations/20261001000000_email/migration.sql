-- Verified email on the account, email notifications opt-in, and one-time email codes.
CREATE TYPE "EmailCodePurpose" AS ENUM ('VERIFY', 'LOGIN');

ALTER TABLE "User" ADD COLUMN "email" TEXT,
ADD COLUMN "emailOptIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "EmailCodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailCode_email_purpose_createdAt_idx" ON "EmailCode"("email", "purpose", "createdAt");
CREATE INDEX "EmailCode_userId_purpose_createdAt_idx" ON "EmailCode"("userId", "purpose", "createdAt");

ALTER TABLE "EmailCode" ADD CONSTRAINT "EmailCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
