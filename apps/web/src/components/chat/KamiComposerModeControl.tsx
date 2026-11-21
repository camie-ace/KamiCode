import type { ProviderInteractionMode } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";
import { ListTodoIcon } from "lucide-react";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl } from "./ComposerControl";

const modes = {
  default: msg("Build"),
  plan: msg("Plan"),
  test: msg("Test"),
  workflow: msg("Workflow"),
  trigger: msg("Trigger"),
} satisfies Record<ProviderInteractionMode, unknown>;

export function KamiComposerModeControl(props: {
  mode: ProviderInteractionMode;
  onChange: (mode: ProviderInteractionMode) => void;
  planOpen: boolean;
  planLabel: string;
  onTogglePlan: (() => void) | undefined;
}) {
  const m = useMessages();
  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl type="button" aria-label={m(msg("Interaction mode"))} />}
      >
        {m(modes[props.mode])}
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={props.mode}
          onValueChange={(value) => {
            if (value && Object.hasOwn(modes, value))
              props.onChange(value as ProviderInteractionMode);
          }}
        >
          {(Object.keys(modes) as ProviderInteractionMode[]).map((mode) => (
            <MenuRadioItem key={mode} value={mode}>
              {m(modes[mode])}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {props.onTogglePlan ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={props.onTogglePlan}>
              <ListTodoIcon />
              {props.planOpen
                ? m(msg("Hide {panel}", { panel: props.planLabel }))
                : m(msg("Show {panel}", { panel: props.planLabel }))}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
