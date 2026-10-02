-- Team join codes (DECISIONS M17): 5 capital letters (no I or O), unique. Existing teams get one.
ALTER TABLE "Team" ADD COLUMN "joinCode" TEXT;

DO $$
DECLARE
  t RECORD;
  c TEXT;
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
BEGIN
  FOR t IN SELECT "id" FROM "Team" LOOP
    LOOP
      c := '';
      FOR i IN 1..5 LOOP
        c := c || substr(alphabet, 1 + floor(random() * 24)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Team" WHERE "joinCode" = c);
    END LOOP;
    UPDATE "Team" SET "joinCode" = c WHERE "id" = t."id";
  END LOOP;
END $$;

ALTER TABLE "Team" ALTER COLUMN "joinCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Team_joinCode_key" ON "Team"("joinCode");
