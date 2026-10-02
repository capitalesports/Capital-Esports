import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { DeletionRequestActions } from "@/components/admin/deletion-request-actions";
import { PageHeader } from "@/components/common/page-header";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listDeletionRequests } from "@/server/services/account-deletion";
import { maskEmail } from "@/lib/contact-display";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Deletion requests" };

const STATUS_LABEL = {
  PENDING: "Pending",
  APPROVED: "Deleted",
  REJECTED: "Declined",
  CANCELLED: "Withdrawn by player",
} as const;

export default async function AdminDeletionRequestsPage() {
  const user = await requireStaffPage("/admin/deletion-requests");
  const { pending, decided } = await listDeletionRequests(toActor(user));

  return (
    <>
      <PageHeader
        title="Deletion requests"
        description="Players ask here to delete their account. Approving erases the account; declining keeps it and notifies the player."
      />

      <section aria-labelledby="pending-h" className="space-y-3">
        <h2 id="pending-h" className="text-lg font-semibold">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pending requests.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => {
              const name = r.user.displayName ?? "(no name)";
              return (
                <li key={r.id} className="card-ds space-y-3 p-4">
                  <div>
                    <Link
                      href={`/admin/users/${r.user.id}`}
                      className="min-h-tap inline-flex items-center font-medium hover:underline"
                    >
                      {name}
                    </Link>
                    <p className="text-muted-foreground text-sm">
                      {r.user.email ? maskEmail(r.user.email) : "No email"} · requested{" "}
                      {formatIST(r.createdAt)}
                    </p>
                  </div>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Reason: </span>
                    {r.reason ?? "None given"}
                  </p>
                  <DeletionRequestActions requestId={r.id} name={name} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="decided-h" className="mt-10 space-y-3">
        <h2 id="decided-h" className="text-lg font-semibold">
          Recent decisions
        </h2>
        {decided.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <ul className="space-y-2">
            {decided.map((r) => (
              <li key={r.id} className="card-ds p-3 text-sm">
                <span className="font-medium">
                  {r.user.deletedAt ? "Deleted account" : (r.user.displayName ?? "(no name)")}
                </span>{" "}
                · {STATUS_LABEL[r.status]}
                {r.decidedAt ? ` · ${formatIST(r.decidedAt)}` : ""}
                {r.decidedBy?.displayName ? ` · by ${r.decidedBy.displayName}` : ""}
                {r.adminNote ? (
                  <span className="text-muted-foreground block">Note: {r.adminNote}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
