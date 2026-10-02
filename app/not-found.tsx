import { IntentLink as Link } from "@/components/common/intent-link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="main"
      className="page-container flex flex-1 flex-col items-center justify-center py-24 text-center"
    >
      <p className="text-primary text-6xl font-extrabold">404</p>
      <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground mt-2">This lobby does not exist or has been closed.</p>
      <Button asChild className="mt-6">
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
