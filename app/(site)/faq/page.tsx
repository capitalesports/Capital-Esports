import type { Metadata } from "next";
import { ContentPage } from "@/components/content/content-page";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return <ContentPage title="FAQ" contentKey="faq" />;
}
