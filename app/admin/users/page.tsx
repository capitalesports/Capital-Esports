import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/common/intent-link";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireStaffPage } from "@/server/auth/guards";
import { toActor } from "@/server/auth/session";
import { searchUsers } from "@/server/services/admin-users";
import { isAccountBanned } from "@/lib/bans";
import { GAME_CONFIG } from "@/lib/games";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const user = await requireStaffPage("/admin/users");
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const users = await searchUsers(toActor(user), query);

  return (
    <>
      <PageHeader title="Users" description="Search by name, email or game ID." />
      <form method="get" role="search" className="mb-4 flex gap-2">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Email, name, UID or Name#Tag"
          aria-label="Search users"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="card-ds overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Game IDs</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.displayName ?? "(no name)"}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {u.email ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {u.gameProfiles
                    .map((p) => `${GAME_CONFIG[p.game].shortName}: ${p.ign ?? p.gameId}`)
                    .join(" · ") || "—"}
                </TableCell>
                <TableCell>{u.role}</TableCell>
                <TableCell>
                  {u.deletedAt
                    ? "Merged"
                    : isAccountBanned(u)
                      ? "Banned"
                      : u.strikes
                        ? `${u.strikes} strike(s)`
                        : "Active"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {users.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">No users match “{query}”.</p>
      ) : null}
    </>
  );
}
