-- A default join code for teams inserted directly (seed, tests, admin tools). The app picks an
-- unused code itself (server/services/teams.ts); the unique index still guards both paths.
CREATE OR REPLACE FUNCTION random_team_code() RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  c TEXT := '';
BEGIN
  FOR i IN 1..5 LOOP
    c := c || substr(alphabet, 1 + floor(random() * 24)::int, 1);
  END LOOP;
  RETURN c;
END $$;

ALTER TABLE "Team" ALTER COLUMN "joinCode" SET DEFAULT random_team_code();
