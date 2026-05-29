import { createFileRoute } from "@tanstack/react-router";

import { ProfileSettingsPanel } from "../components/settings/ProfileSettings";

export const Route = createFileRoute("/settings/profile")({
  component: ProfileSettingsPanel,
});
