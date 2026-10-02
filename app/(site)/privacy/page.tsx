import type { Metadata } from "next";
import { ContentPage } from "@/components/content/content-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return <ContentPage title="Privacy policy" contentKey="privacy" />;
}
