// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { SidebarCreatorFilter } from "./SidebarCreatorFilter";

const originalGetAnimations = Element.prototype.getAnimations;
let root: Root;
let container: HTMLDivElement;
const people = [
  { value: "alice", label: "Alice (@alice)", avatarUrl: null },
  { value: "bob", label: "Bob (@bob)", avatarUrl: null },
  { value: "carol", label: "Carol (@carol)", avatarUrl: null },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Element.prototype.getAnimations = originalGetAnimations;
  vi.unstubAllGlobals();
});

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
        <output>{selected.join(",") || "all"}</output>
      </TooltipProvider>
    </SidebarProvider>
  );
}

function element(selector: string) {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
function option(label: string) {
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes(label),
  );
  if (!found) throw new Error(`Missing option ${label}`);
  return found;
}
async function search(value: string) {
  await act(async () => {
    const input = element('input[aria-label="Search people"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("creator picker interactions", () => {
  it("keeps the popup open for multiple selections, searches, deselects, and clears", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => element('button[aria-label="Filter threads by creator"]').click());
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
    await act(async () => option("Alice").click());
    expect(element("output").textContent).toBe("alice");
    expect(option("Alice").getAttribute("aria-selected")).toBe("true");
    await act(async () => option("Bob").click());
    expect(element("output").textContent).toBe("alice,bob");
    await search("carol");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(async () => option("Carol").click());
    expect(element("output").textContent).toBe("alice,bob,carol");
    await search("no-such-person");
    expect(document.body.textContent).toContain("No matching people.");
    await search("");
    await act(async () => option("Bob").click());
    expect(element("output").textContent).toBe("alice,carol");
    const clear = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Clear people filter",
    )!;
    await act(async () => clear.click());
    expect(element("output").textContent).toBe("all");
    expect(document.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(0);
  });
});
