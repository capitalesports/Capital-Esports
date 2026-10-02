"use client";

import { useState } from "react";
import {
  deleteCarouselItemAction,
  deleteSponsorAction,
  saveCarouselItemAction,
  saveContentAction,
  saveHomeSettingsAction,
  saveSocialLinksAction,
  saveSponsorAction,
} from "@/app/admin/content/actions";
import { FormField } from "@/components/common/form-field";
import { NativeSelect } from "@/components/common/native-select";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTENT_KEYS,
  CONTENT_LABEL,
  type ContentKey,
  type HomeSettings,
} from "@/lib/content-keys";
import { GAME_LIST } from "@/lib/games";
import { SOCIAL_LABELS, SOCIAL_PLATFORMS, type SocialLink } from "@/lib/site";

export function MarkdownContentEditor({ initial }: { initial: Record<ContentKey, string> }) {
  const [key, setKey] = useState<ContentKey>("rules.FREE_FIRE");
  const [bodies, setBodies] = useState(initial);
  const { run, pending, fieldErrors } = useAction(saveContentAction);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ key, body: bodies[key] });
      }}
    >
      <FormField id="content-key" label="Page">
        <NativeSelect
          id="content-key"
          value={key}
          onChange={(e) => setKey(e.target.value as ContentKey)}
        >
          {CONTENT_KEYS.map((k) => (
            <option key={k} value={k}>
              {CONTENT_LABEL[k]}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField
        id="content-body"
        label="Markdown"
        help="Headings (#), lists (-), **bold**, links [text](https://…)."
        errors={fieldErrors.body}
      >
        <Textarea
          id="content-body"
          rows={16}
          className="font-mono text-sm"
          value={bodies[key]}
          onChange={(e) => setBodies((b) => ({ ...b, [key]: e.target.value }))}
        />
      </FormField>
      <Button type="submit" disabled={pending}>
        Save {CONTENT_LABEL[key]}
      </Button>
    </form>
  );
}

type HomeForm = Omit<HomeSettings, "trailerUrl"> & { trailerUrl: string };

/** Home page: hero stats (text, or live counts), the "Watch Trailer" link and the hero panel taglines. */
export function HomeSettingsEditor({ settings }: { settings: HomeSettings }) {
  const [v, setV] = useState<HomeForm>({ ...settings, trailerUrl: settings.trailerUrl ?? "" });
  const { run, pending, fieldErrors } = useAction(saveHomeSettingsAction);
  const text = (field: Exclude<keyof HomeForm, "liveStats">, label: string, hint?: string) => (
    <FormField id={`home-${field}`} label={label} errors={fieldErrors[field]} help={hint}>
      <Input
        id={`home-${field}`}
        value={v[field]}
        onChange={(e) => setV({ ...v, [field]: e.target.value })}
      />
    </FormField>
  );
  return (
    <form
      aria-label="Home page settings"
      className="card-ds grid gap-4 p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(v);
      }}
    >
      <p className="text-muted-foreground text-sm sm:col-span-3">
        Hero stats are shown exactly as typed (leave one empty to hide it). The defaults are the
        design&apos;s demo values: replace them with true numbers, or switch on live stats, before
        launch.
      </p>
      {text("statPlayers", "Active Players")}
      {text("statTournaments", "Tournaments")}
      {text("statPrize", "Total Prize Pool")}
      <div className="flex items-center gap-2 sm:col-span-3">
        <Checkbox
          id="home-liveStats"
          checked={v.liveStats}
          onCheckedChange={(c) => setV({ ...v, liveStats: c === true })}
        />
        <Label htmlFor="home-liveStats">
          Use live stats (real counts from the database instead of the text above)
        </Label>
      </div>
      <div className="sm:col-span-3">
        {text("trailerUrl", "Watch Trailer link", "https link; leave empty to hide the button")}
      </div>
      {text("taglineFreeFire", "Free Fire tagline", "Two parts separated by ·")}
      {text("taglineBgmi", "BGMI tagline")}
      {text("taglineValorant", "Valorant tagline")}
      <div className="sm:col-span-3">
        <Button type="submit" disabled={pending}>
          Save home page
        </Button>
      </div>
    </form>
  );
}

export function SocialLinksEditor({ links }: { links: SocialLink[] }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(links.map((l) => [l.platform, l.url ?? ""])),
  );
  const { run, pending, fieldErrors } = useAction(saveSocialLinksAction);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(values);
      }}
    >
      {SOCIAL_PLATFORMS.map((p) => (
        <FormField key={p} id={`social-${p}`} label={SOCIAL_LABELS[p]} errors={fieldErrors[p]}>
          <Input
            id={`social-${p}`}
            type="url"
            placeholder="https://"
            value={values[p] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
          />
        </FormField>
      ))}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Save social links
        </Button>
      </div>
    </form>
  );
}

export interface SponsorValue {
  id?: string;
  name: string;
  logoUrl: string;
  url: string;
  order: number;
  active: boolean;
}

export function SponsorEditor({ sponsor }: { sponsor?: SponsorValue }) {
  const [v, setV] = useState<SponsorValue>(
    sponsor ?? { name: "", logoUrl: "", url: "", order: 0, active: true },
  );
  const save = useAction(saveSponsorAction);
  const del = useAction(deleteSponsorAction);
  const p = `sp-${sponsor?.id ?? "new"}`;
  return (
    <form
      aria-label={sponsor ? `Sponsor ${sponsor.name}` : "New sponsor"}
      className="border-border grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await save.run({ ...v, url: v.url || undefined });
        if (r.ok && !sponsor) setV({ name: "", logoUrl: "", url: "", order: 0, active: true });
      }}
    >
      <FormField id={`${p}-name`} label="Name" errors={save.fieldErrors.name}>
        <Input
          id={`${p}-name`}
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
      </FormField>
      <FormField id={`${p}-logo`} label="Logo URL" errors={save.fieldErrors.logoUrl}>
        <Input
          id={`${p}-logo`}
          value={v.logoUrl}
          onChange={(e) => setV({ ...v, logoUrl: e.target.value })}
          placeholder="https://"
        />
      </FormField>
      <FormField id={`${p}-url`} label="Website (optional)" errors={save.fieldErrors.url}>
        <Input
          id={`${p}-url`}
          value={v.url}
          onChange={(e) => setV({ ...v, url: e.target.value })}
          placeholder="https://"
        />
      </FormField>
      <FormField id={`${p}-order`} label="Order" errors={save.fieldErrors.order}>
        <Input
          id={`${p}-order`}
          type="number"
          min={0}
          value={v.order}
          onChange={(e) => setV({ ...v, order: Number(e.target.value) })}
        />
      </FormField>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${p}-active`}
          checked={v.active}
          onCheckedChange={(c) => setV({ ...v, active: c === true })}
        />
        <Label htmlFor={`${p}-active`}>Active</Label>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={save.pending}>
          {sponsor ? "Save" : "Add sponsor"}
        </Button>
        {sponsor?.id ? (
          <Button
            type="button"
            variant="destructive"
            disabled={del.pending}
            onClick={() => del.run({ id: sponsor.id! })}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export interface CarouselValue {
  id?: string;
  game: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  linkUrl: string;
  order: number;
  active: boolean;
}

export function CarouselItemEditor({ item }: { item?: CarouselValue }) {
  const empty: CarouselValue = {
    game: "",
    title: "",
    subtitle: "",
    imageUrl: "",
    linkUrl: "",
    order: 0,
    active: true,
  };
  const [v, setV] = useState<CarouselValue>(item ?? empty);
  const save = useAction(saveCarouselItemAction);
  const del = useAction(deleteCarouselItemAction);
  const p = `ci-${item?.id ?? "new"}`;
  return (
    <form
      aria-label={item ? `Carousel item ${item.title}` : "New carousel item"}
      className="border-border grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await save.run({
          ...v,
          game: v.game || undefined,
          subtitle: v.subtitle || undefined,
          imageUrl: v.imageUrl || undefined,
          linkUrl: v.linkUrl || undefined,
        });
        if (r.ok && !item) setV(empty);
      }}
    >
      <FormField id={`${p}-title`} label="Title" errors={save.fieldErrors.title}>
        <Input
          id={`${p}-title`}
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
        />
      </FormField>
      <FormField id={`${p}-game`} label="Game (logo)" errors={save.fieldErrors.game}>
        <NativeSelect
          id={`${p}-game`}
          value={v.game}
          onChange={(e) => setV({ ...v, game: e.target.value })}
        >
          <option value="">None</option>
          {GAME_LIST.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id={`${p}-subtitle`} label="Subtitle" errors={save.fieldErrors.subtitle}>
        <Input
          id={`${p}-subtitle`}
          value={v.subtitle}
          onChange={(e) => setV({ ...v, subtitle: e.target.value })}
        />
      </FormField>
      <FormField id={`${p}-image`} label="Image URL (optional)" errors={save.fieldErrors.imageUrl}>
        <Input
          id={`${p}-image`}
          value={v.imageUrl}
          onChange={(e) => setV({ ...v, imageUrl: e.target.value })}
        />
      </FormField>
      <FormField id={`${p}-link`} label="Link (optional)" errors={save.fieldErrors.linkUrl}>
        <Input
          id={`${p}-link`}
          value={v.linkUrl}
          onChange={(e) => setV({ ...v, linkUrl: e.target.value })}
          placeholder="/tournament/bgmi"
        />
      </FormField>
      <FormField id={`${p}-order`} label="Order" errors={save.fieldErrors.order}>
        <Input
          id={`${p}-order`}
          type="number"
          min={0}
          value={v.order}
          onChange={(e) => setV({ ...v, order: Number(e.target.value) })}
        />
      </FormField>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${p}-active`}
          checked={v.active}
          onCheckedChange={(c) => setV({ ...v, active: c === true })}
        />
        <Label htmlFor={`${p}-active`}>Active</Label>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={save.pending}>
          {item ? "Save" : "Add item"}
        </Button>
        {item?.id ? (
          <Button
            type="button"
            variant="destructive"
            disabled={del.pending}
            onClick={() => del.run({ id: item.id! })}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
