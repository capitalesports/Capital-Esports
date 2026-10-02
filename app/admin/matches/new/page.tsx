import type { Metadata } from "next";
import { EMPTY_MATCH_FORM, MatchForm } from "@/components/admin/match-form";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { paymentsEnabled } from "@/server/env";
import { listTournamentOptions } from "@/server/queries/admin-matches";

export const metadata: Metadata = { title: "New match" };

export default async function NewMatchPage() {
  await requireStaffPage("/admin/matches/new");
  const tournaments = await listTournamentOptions();
  return (
    <>
      <PageHeader title="New match" description="Enter times in IST; they are stored in UTC." />
      <MatchForm
        initial={EMPTY_MATCH_FORM}
        tournaments={tournaments}
        paymentsEnabled={paymentsEnabled()}
      />
    </>
  );
}
