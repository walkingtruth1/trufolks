// WEB-17-02: the old video-licensing page is retired. Keep the link working by
// sending visitors to its current equivalent on the homepage.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/offer")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "merchants", statusCode: 301 });
  },
});
