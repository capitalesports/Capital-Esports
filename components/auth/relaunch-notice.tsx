import { IntentLink as Link } from "@/components/common/intent-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Login page: old accounts were removed at the relaunch, so players sign up again (M55). */
export function RelaunchNotice({ signupHref }: { signupHref: string }) {
  return (
    <div role="note" className="card-ds border-gold bg-gold/10 mb-6 space-y-2 p-4 text-sm">
      <p className="text-gold font-semibold">Capital Esports has relaunched</p>
      <p>
        All accounts made before the relaunch were removed. Please <strong>sign up again</strong> to
        create a new account. You can use the same email, or Continue with Google.
      </p>
      <Link href={signupHref} className={cn(buttonVariants({ variant: "default" }), "w-full")}>
        Sign up
      </Link>
    </div>
  );
}
