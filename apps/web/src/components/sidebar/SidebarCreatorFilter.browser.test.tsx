import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { SidebarCreatorFilter } from "./SidebarCreatorFilter";

const people = [
  { value: "alice", label: "Alice (@alice)", avatarUrl: null },
  { value: "bob", label: "Bob (@bob)", avatarUrl: null },
  { value: "carol", label: "Carol (@carol)", avatarUrl: null },
];

function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <SidebarProvider>
      <TooltipProvider>
        <SidebarCreatorFilter
          creatorItems={people}
          creatorLogins={selected}
          setCreatorLogins={setSelected}
        />
        <output aria-label="Selected people">{selected.join(",") || "all"}</output>
      </TooltipProvider>
    </SidebarProvider>
  );
}

it("keeps the popup open for multiple selections, searches, deselects, and clears", async () => {
  await using screen = await render(<Harness />);
  await userEvent.click(
    screen.getByRole("combobox", { name: "Filter threads by creator", exact: true }),
  );
  const alice = page.getByRole("option", { name: "Alice (@alice)" });
  const bob = page.getByRole("option", { name: "Bob (@bob)" });
  const search = page.getByRole("combobox", { name: "Search people" });
  await userEvent.click(alice);
  await expect
    .element(screen.getByRole("status", { name: "Selected people" }))
    .toHaveTextContent("alice");
  await expect.element(alice).toHaveAttribute("aria-selected", "true");
  await userEvent.click(bob);
  await expect
    .element(screen.getByRole("status", { name: "Selected people" }))
    .toHaveTextContent("alice,bob");
  await search.fill("carol");
  await expect.element(alice).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("option", { name: "Carol (@carol)" }));
  await expect
    .element(screen.getByRole("status", { name: "Selected people" }))
    .toHaveTextContent("alice,bob,carol");
  await search.fill("no-such-person");
  await expect.element(page.getByText("No matching people.")).toBeVisible();
  await search.fill("");
  await userEvent.click(bob);
  await expect
    .element(screen.getByRole("status", { name: "Selected people" }))
    .toHaveTextContent("alice,carol");
  await userEvent.click(page.getByRole("button", { name: "Clear people filter" }));
  await expect
    .element(screen.getByRole("status", { name: "Selected people" }))
    .toHaveTextContent("all");
  await expect.element(alice).toHaveAttribute("aria-selected", "false");
  await expect.element(bob).toHaveAttribute("aria-selected", "false");
});
