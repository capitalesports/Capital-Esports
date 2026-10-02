-- The owner can reveal their full UPI ID on the profile (the masked form is still used everywhere else).
ALTER TABLE "PayoutMethod" ADD COLUMN "vpa" TEXT;
