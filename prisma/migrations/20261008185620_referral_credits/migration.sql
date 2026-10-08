-- CreateTable
CREATE TABLE "ReferralCreditUse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "valuePaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCreditUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCreditUse_registrationId_key" ON "ReferralCreditUse"("registrationId");

-- CreateIndex
CREATE INDEX "ReferralCreditUse_userId_idx" ON "ReferralCreditUse"("userId");

-- AddForeignKey
ALTER TABLE "ReferralCreditUse" ADD CONSTRAINT "ReferralCreditUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCreditUse" ADD CONSTRAINT "ReferralCreditUse_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

