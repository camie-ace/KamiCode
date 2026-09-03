import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode, useState } from "react";
import { EllipsisIcon, ListTodoIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { composerFloatingLayerProps } from "./composerEventScope";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  size?: "sm" | "xs";
  hidden?: boolean;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const size = props.size ?? "sm";
  const [open, setOpen] = useState(false);
  const hidden = props.hidden ?? false;
  // Base UI does not report a close it did not initiate, so clear the state
  // when the trigger hides or the menu would reopen by itself when the
  // trigger returns.
  const [wasHidden, setWasHidden] = useState(hidden);
  if (hidden !== wasHidden) {
    setWasHidden(hidden);
    if (hidden) setOpen(false);
  }

  return (
    <Menu open={open && !hidden} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            variant="ghost"
            className={size === "xs" ? "shrink-0" : "shrink-0 px-2"}
            aria-label="More composer controls"
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onInteractionModeChange(value as ProviderInteractionMode);
              }}
            >
              <MenuRadioItem value="default">Build</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
              <MenuRadioItem value="test">Test</MenuRadioItem>
              <MenuRadioItem value="workflow">Workflow</MenuRadioItem>
              <MenuRadioItem value="trigger">Trigger</MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
          <MenuRadioItem value="auto-accept-edits">Auto-accept edits</MenuRadioItem>
          <MenuRadioItem value="auto">Auto</MenuRadioItem>
          <MenuRadioItem value="full-access">Full access</MenuRadioItem>
        </MenuRadioGroup>
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen
                ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
