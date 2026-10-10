-- CreateEnum
CREATE TYPE "ManualPaymentStatus" AS ENUM ('AWAITING_PROOF', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "UpiApp" AS ENUM ('GOOGLE_PAY', 'PHONEPE', 'PAYTM', 'BHIM', 'AMAZON_PAY', 'CRED', 'OTHER');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "paymentQrUrl" TEXT;

-- CreateTable
CREATE TABLE "ManualPayment" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "ManualPaymentStatus" NOT NULL DEFAULT 'AWAITING_PROOF',
    "app" "UpiApp",
    "transactionId" TEXT,
    "screenshotUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManualPayment_registrationId_key" ON "ManualPayment"("registrationId");

-- CreateIndex
CREATE INDEX "ManualPayment_status_submittedAt_idx" ON "ManualPayment"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "ManualPayment_transactionId_idx" ON "ManualPayment"("transactionId");

-- CreateIndex
CREATE INDEX "ManualPayment_userId_idx" ON "ManualPayment"("userId");

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

