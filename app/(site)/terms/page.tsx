import type { Metadata } from "next";
import { ContentPage } from "@/components/content/content-page";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return <ContentPage title="Terms of service" contentKey="terms" />;
}
