import { CheckIcon, UsersIcon } from "lucide-react";
import { useMemo, useState, type RefObject } from "react";
import { GitHubIcon } from "../Icons";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
  useComboboxFilter,
} from "../ui/combobox";

interface CreatorItem {
  value: string;
  label: string;
  avatarUrl: string | null;
}

function ThreadCreatorAvatar({ avatarUrl }: { avatarUrl: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <span className="grid size-3 shrink-0 place-items-center overflow-hidden rounded-full border border-border/70 bg-muted">
      {avatarUrl !== null && !imageFailed ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <GitHubIcon aria-hidden className="size-2.5 text-muted-foreground" />
      )}
    </span>
  );
}

export function SidebarCreatorFilter({
  creatorItems,
  creatorLogins,
  setCreatorLogins,
  headerSearchRef,
}: {
  creatorItems: CreatorItem[];
  creatorLogins: readonly string[];
  setCreatorLogins: (logins: string[]) => void;
  headerSearchRef?: RefObject<HTMLDivElement | null>;
}) {
  const selectedCreatorLogins = useMemo(() => new Set(creatorLogins), [creatorLogins]);
  const selectedCreatorItems = useMemo(
    () => creatorItems.filter((item) => selectedCreatorLogins.has(item.value)),
    [creatorItems, selectedCreatorLogins],
  );
  const [creatorQuery, setCreatorQuery] = useState("");
  const creatorFilter = useComboboxFilter();
  const filteredCreatorItems = useMemo(
    () => creatorItems.filter((item) => creatorFilter.contains(item.label, creatorQuery)),
    [creatorItems, creatorFilter, creatorQuery],
  );
  return (
    <Combobox
      multiple
      items={creatorItems}
      filteredItems={filteredCreatorItems}
      value={selectedCreatorItems}
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      onValueChange={(items) => setCreatorLogins(items.map((item) => item.value))}
      onOpenChange={() => setCreatorQuery("")}
    >
      <ComboboxTrigger
        render={
          <SidebarHeaderIconButton
            label={
              creatorLogins.length > 0
                ? `Filter threads by creator: ${selectedCreatorItems.map((item) => item.label).join(", ")}`
                : "Filter threads by creator"
            }
          />
        }
      >
        <UsersIcon className="size-4" />
        {creatorLogins.length > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-3xs leading-3 text-primary-foreground">
            {creatorLogins.length}
          </span>
        ) : null}
      </ComboboxTrigger>
      <ComboboxPopup
        align="start"
        anchor={headerSearchRef}
        className="max-w-[min(22rem,var(--available-width))] overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-xs font-medium">Created by</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={creatorLogins.length === 0}
            onClick={() => {
              setCreatorLogins([]);
              setCreatorQuery("");
            }}
          >
            Clear people filter
          </Button>
        </div>
        <ComboboxSearchInput
          aria-label="Search people"
          placeholder="Search people..."
          value={creatorQuery}
          onChange={(event) => setCreatorQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching people.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof creatorItems)[number]) => (
            <ComboboxItem key={item.value} value={item}>
              <ThreadCreatorAvatar avatarUrl={item.avatarUrl} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {selectedCreatorLogins.has(item.value) ? <CheckIcon className="size-4" /> : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
