import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { AuditTable } from "@/components/admin/audit-table";
import { NativeSelect } from "@/components/common/native-select";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { listAuditLogs } from "@/server/services/audit-log";

export const metadata: Metadata = { title: "Audit log" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v ? v : undefined;
}

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const user = await requireStaffPage("/admin/audit");
  const sp = await searchParams;
  const filters = {
    actor: str(sp.actor),
    entityType: str(sp.entityType),
    entityId: str(sp.entityId),
    action: str(sp.action),
    from: str(sp.from),
    to: str(sp.to),
    page: Number(str(sp.page) ?? 1) || 1,
  };
  const { rows, total, page, pages, entityTypes } = await listAuditLogs(toActor(user), filters);
  const qs = (p: number) => {
    const params = new URLSearchParams(
      Object.entries({ ...filters, page: String(p) }).filter(([, v]) => v) as [string, string][],
    );
    return `/admin/audit?${params}`;
  };
  const exportHref = `/admin/audit/export?${new URLSearchParams(
    Object.entries(filters).filter(([k, v]) => k !== "page" && v) as [string, string][],
  )}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`${total} entries. Every admin and moderator action, with who, what and when.`}
      >
        <Button asChild variant="outline">
          <a href={exportHref}>Export CSV</a>
        </Button>
      </PageHeader>
      <form
        method="get"
        className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Filter audit log"
      >
        <div className="space-y-1">
          <Label htmlFor="a-actor">Who</Label>
          <Input
            id="a-actor"
            name="actor"
            defaultValue={filters.actor}
            placeholder="name, phone or system"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-entity">Entity</Label>
          <NativeSelect id="a-entity" name="entityType" defaultValue={filters.entityType ?? ""}>
            <option value="">All</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-action">Action starts with</Label>
          <Input id="a-action" name="action" defaultValue={filters.action} placeholder="match." />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-from">From</Label>
          <Input id="a-from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-to">To</Label>
          <Input id="a-to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/audit">Reset</Link>
          </Button>
        </div>
        {filters.entityId ? <input type="hidden" name="entityId" value={filters.entityId} /> : null}
      </form>
      <AuditTable rows={rows} />
      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline">
              <Link href={qs(page - 1)}>Previous</Link>
            </Button>
          ) : null}
          <span className="text-muted-foreground text-sm">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="outline">
              <Link href={qs(page + 1)}>Next</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
