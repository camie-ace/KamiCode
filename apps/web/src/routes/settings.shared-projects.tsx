import { createFileRoute } from "@tanstack/react-router";

import { SharedProjectsSettings } from "../components/settings/SharedProjectsSettings";

export const Route = createFileRoute("/settings/shared-projects")({
  component: SharedProjectsSettings,
});
