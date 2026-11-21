import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { memo, useRef } from "react";
import { EllipsisIcon, ListTodoIcon } from "lucide-react";
import {
  Menu,
  MenuPopup,
  MenuTrigger,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
} from "../ui/menu";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { focusRequestedPermission, useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";
import { ComposerPermissionsSection, type RuntimeModeOption } from "./ComposerFooterControls";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan?: boolean;
  interactionMode?: ProviderInteractionMode;
  showInteractionModeToggle?: boolean;
  planSidebarLabel?: string;
  planSidebarOpen?: boolean;
  onInteractionModeChange?: (mode: ProviderInteractionMode) => void;
  onTogglePlanSidebar?: () => void;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  showPermissions: boolean;
  size?: "sm" | "xs";
  /** Close the portaled popup when its trigger hides. */
  hidden?: boolean;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const gt = useGT();
  const composerFloatingLayerProps = useComposerMenuProps();
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => focusRequestedPermission(isOpen, triggerRef.current)}
    >
      <MenuTrigger
        render={
          <ComposerControl
            ref={triggerRef}
            size={size}
            className="shrink-0"
            aria-label={gt("More composer controls")}
            data-composer-shortcut={props.showPermissions ? "composer.mode" : undefined}
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              <T>Mode</T>
            </div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onInteractionModeChange?.(value as ProviderInteractionMode);
              }}
            >
              <MenuRadioItem value="default">
                <T>Build</T>
              </MenuRadioItem>
              <MenuRadioItem value="plan">
                <T>Plan</T>
              </MenuRadioItem>
              <MenuRadioItem value="test">
                <T>Test</T>
              </MenuRadioItem>
              <MenuRadioItem value="workflow">
                <T>Workflow</T>
              </MenuRadioItem>
              <MenuRadioItem value="trigger">
                <T>Trigger</T>
              </MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        {props.showPermissions ? (
          <ComposerPermissionsSection
            runtimeMode={props.runtimeMode}
            runtimeModeOptions={props.runtimeModeOptions}
            onRuntimeModeChange={props.onRuntimeModeChange}
          />
        ) : null}
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen
                ? `Hide ${(props.planSidebarLabel ?? "Plan").toLowerCase()} sidebar`
                : `Show ${(props.planSidebarLabel ?? "Plan").toLowerCase()} sidebar`}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
