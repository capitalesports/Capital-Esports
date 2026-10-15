-- New scrim / tournament alerts to every player (DECISIONS M64).
ALTER TABLE "Match" ADD COLUMN "openNoticeSentAt" TIMESTAMP(3);
ALTER TABLE "Tournament" ADD COLUMN "announcedAt" TIMESTAMP(3);

-- Nothing that already exists is announced again: only matches that open from now on get an alert.
UPDATE "Match" SET "openNoticeSentAt" = CURRENT_TIMESTAMP WHERE "status" <> 'UPCOMING';
UPDATE "Tournament" SET "announcedAt" = CURRENT_TIMESTAMP;
