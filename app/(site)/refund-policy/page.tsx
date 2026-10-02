import type { Metadata } from "next";
import { ContentPage } from "@/components/content/content-page";

export const metadata: Metadata = { title: "Refund policy" };

export default function RefundPolicyPage() {
  return <ContentPage title="Refund policy" contentKey="refund-policy" />;
}
