-- CreateEnum
CREATE TYPE "PayoutMethodKind" AS ENUM ('UPI', 'BANK');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "amountPaise" INTEGER NOT NULL,
ADD COLUMN     "cfPaymentId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "orderId" TEXT NOT NULL,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "rawWebhook" JSONB,
ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "registrationId" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "amountPaise" INTEGER NOT NULL,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "beneficiaryId" TEXT,
ADD COLUMN     "cfTransferId" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "method" "PayoutMethodKind",
ADD COLUMN     "place" INTEGER NOT NULL,
ADD COLUMN     "rawResponse" JSONB,
ADD COLUMN     "seasonId" TEXT,
ADD COLUMN     "secondApprovedById" TEXT,
ADD COLUMN     "tournamentId" TEXT,
ADD COLUMN     "transferId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "PayoutMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PayoutMethodKind" NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "vpaMasked" TEXT,
    "accountLast4" TEXT,
    "ifsc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationFlag" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ours" TEXT NOT NULL,
    "theirs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutMethod_userId_key" ON "PayoutMethod"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutMethod_beneficiaryId_key" ON "PayoutMethod"("beneficiaryId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventKey_key" ON "WebhookEvent"("eventKey");

-- CreateIndex
CREATE INDEX "ReconciliationFlag_resolvedAt_idx" ON "ReconciliationFlag"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_registrationId_key" ON "Payment"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_refundId_key" ON "Payment"("refundId");

-- CreateIndex
CREATE INDEX "Payment_status_expiresAt_idx" ON "Payment"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_transferId_key" ON "Payout"("transferId");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_userId_tournamentId_key" ON "Payout"("userId", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_userId_seasonId_key" ON "Payout"("userId", "seasonId");

-- AddForeignKey
ALTER TABLE "PayoutMethod" ADD CONSTRAINT "PayoutMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

