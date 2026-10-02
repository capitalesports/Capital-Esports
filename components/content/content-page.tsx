import { PageHeader } from "@/components/common/page-header";
import { getContent } from "@/server/services/content";
import type { ContentKey } from "@/lib/content";
import { DEFAULT_CONTENT } from "@/lib/default-content";
import { Markdown } from "./markdown";

/** A static page whose body comes from Admin → Content (with starter text until edited). */
export async function ContentPage({
  title,
  contentKey,
  description,
}: {
  title: string;
  contentKey: ContentKey;
  description?: string;
}) {
  const body = (await getContent(contentKey)) || DEFAULT_CONTENT[contentKey];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={title} description={description} />
      <Markdown className="text-base">{body}</Markdown>
    </div>
  );
}
