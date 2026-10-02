"use client";

import { useState } from "react";
import { submitContactAction } from "@/app/(site)/contact/actions";
import { FormField } from "@/components/common/form-field";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const empty = { name: "", contact: "", message: "", website: "" };
  const [v, setV] = useState(empty);
  const [sent, setSent] = useState(false);
  const { run, pending, fieldErrors } = useAction(submitContactAction);
  if (sent) {
    return (
      <p role="status" className="card-ds p-4">
        Thanks! Your message is with the team.
      </p>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(v);
        if (r.ok) {
          setV(empty);
          setSent(true);
        }
      }}
    >
      <FormField id="c-name" label="Your name" errors={fieldErrors.name}>
        <Input
          id="c-name"
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          autoComplete="name"
        />
      </FormField>
      <FormField
        id="c-contact"
        label="How can we reach you?"
        help="Email or Discord username"
        errors={fieldErrors.contact}
      >
        <Input
          id="c-contact"
          value={v.contact}
          onChange={(e) => setV({ ...v, contact: e.target.value })}
        />
      </FormField>
      <FormField id="c-message" label="Message" errors={fieldErrors.message}>
        <Textarea
          id="c-message"
          rows={5}
          value={v.message}
          onChange={(e) => setV({ ...v, message: e.target.value })}
        />
      </FormField>
      <div aria-hidden className="hidden">
        <label htmlFor="c-website">Website</label>
        <input
          id="c-website"
          tabIndex={-1}
          autoComplete="off"
          value={v.website}
          onChange={(e) => setV({ ...v, website: e.target.value })}
        />
      </div>
      <Button type="submit" disabled={pending}>
        Send message
      </Button>
    </form>
  );
}
