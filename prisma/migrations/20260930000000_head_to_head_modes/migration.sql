-- Head-to-head modes (1v1, 2v2, 4v4) next to the existing SOLO/DUO/SQUAD/FIVE_V_FIVE.
ALTER TYPE "MatchMode" ADD VALUE 'ONE_V_ONE' BEFORE 'FIVE_V_FIVE';
ALTER TYPE "MatchMode" ADD VALUE 'TWO_V_TWO' BEFORE 'FIVE_V_FIVE';
ALTER TYPE "MatchMode" ADD VALUE 'FOUR_V_FOUR' BEFORE 'FIVE_V_FIVE';

-- Tournaments now record their mode. Existing ones: brackets were 5v5, lobby-points were squads.
ALTER TABLE "Tournament" ADD COLUMN "mode" "MatchMode";
UPDATE "Tournament" SET "mode" = CASE WHEN "format" = 'BRACKET' THEN 'FIVE_V_FIVE'::"MatchMode" ELSE 'SQUAD'::"MatchMode" END;
ALTER TABLE "Tournament" ALTER COLUMN "mode" SET NOT NULL;
