import { createOxlintRuleHarness } from "../test/utils.ts";

const legacy = createOxlintRuleHarness("t3code/no-untranslated-copy", {
  filename: "apps/web/src/components/ThreadLockDialog.tsx",
});
legacy.valid("retains an existing English label", "export const dialog = <label>Passcode</label>;");
legacy.invalid(
  "rejects additional occurrences of an existing label",
  "export const dialog = <><label>Passcode</label><label>Passcode</label></>;",
);
legacy.invalid(
  "rejects new copy in a legacy file",
  "export const dialog = <label>A new untranslated label</label>;",
);
createOxlintRuleHarness("t3code/no-untranslated-copy", {
  filename: "apps/web/src/NewDialog.tsx",
}).invalid("keeps new files fully checked", "export const dialog = <label>Passcode</label>;");
