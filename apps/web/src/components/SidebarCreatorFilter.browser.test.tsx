import { createMemoryHistory } from "@tanstack/react-router";
import { KamiUserId, ProjectId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { useUiStateStore } from "~/uiStateStore";
import {
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

function appContainer() {
  const container = document.createElement("div");
  container.style.height = "100vh";
  return container;
}

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it.each([false, true])("filters one or multiple creators with project scope=%s", async (scoped) => {
  await page.viewport(1400, 900);
  const secondProject = ProjectId.make("creator-second-project");
  const fixtures = [
    ["Alice first", "alice", PROJECT_ID],
    ["Bob first", "bob", PROJECT_ID],
    ["Alice second", "alice", secondProject],
    ["Bob second", "bob", secondProject],
  ].map(([title, login, projectId]) => ({
    ...threadWithHistory(title!, 1),
    title: title!,
    projectId: ProjectId.make(projectId!),
    createdByUser: {
      userId: KamiUserId.make(login!),
      githubLogin: login!,
      displayName: login === "alice" ? "Alice" : "Bob",
      avatarUrl: null,
    },
  }));
  using _environment = installFakeEnvironment(fixtures, {
    extraProjects: [{ id: secondProject, title: "creator-second" }],
  });
  const previous = useUiStateStore.getState();
  using _restoreFilters = {
    [Symbol.dispose]() {
      useUiStateStore.getState().setSidebarCreatorLogins(previous.sidebarCreatorLogins);
      useUiStateStore.getState().setSidebarProjectScopeKeys(previous.sidebarProjectScopeKeys);
    },
  };
  useUiStateStore.getState().setSidebarCreatorLogins([]);
  useUiStateStore.getState().setSidebarProjectScopeKeys([]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(createMemoryHistory({ initialEntries: ["/"] }));
  await router.load();
  await using screen = await render(<AppRoot router={router} />, {
    container: appContainer(),
    // AppRoot brings its own router.
    router: false,
  });
  const row = (name: string) => screen.getByText(name, { exact: true });
  await expect.element(row("Alice first")).toBeVisible();
  if (scoped) {
    await screen.getByRole("combobox", { name: /^Filter threads by project/ }).click();
    await page.getByRole("option", { name: /creator-second/ }).click();
  }
  const people = screen.getByRole("combobox", { name: /^Filter threads by creator/ });
  await people.click();
  await page.getByRole("option", { name: "Alice (@alice)" }).click();
  await userEvent.keyboard("{Escape}");
  await expect.element(row("Alice second")).toBeVisible();
  await expect.element(row("Bob second")).not.toBeInTheDocument();
  if (scoped) await expect.element(row("Alice first")).not.toBeInTheDocument();
  else await expect.element(row("Alice first")).toBeVisible();
  await people.click();
  await page.getByRole("option", { name: "Bob (@bob)" }).click();
  await userEvent.keyboard("{Escape}");
  await expect.element(row("Alice second")).toBeVisible();
  await expect.element(row("Bob second")).toBeVisible();
  if (scoped) await expect.element(row("Bob first")).not.toBeInTheDocument();
  else await expect.element(row("Bob first")).toBeVisible();
});
