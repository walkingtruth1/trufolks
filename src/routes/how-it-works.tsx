import { createFileRoute } from "@tanstack/react-router";
import { HowItWorksPage } from "@/components/how-it-works";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How TruFolks works" }] }),
  component: HowItWorksPage,
});
