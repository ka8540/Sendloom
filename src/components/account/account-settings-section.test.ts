import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { UserRound } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AccountSettingsSection } from "./account-settings-section";

function render(expanded: boolean) {
  return renderToStaticMarkup(
    createElement(AccountSettingsSection, {
      id: "information", title: "Account information", description: "Manage your profile and account details.",
      icon: UserRound, expanded, onToggle: () => {},
      children: createElement("a", { href: "/account" }, "Account details"),
    })
  );
}

describe("AccountSettingsSection", () => {
  it("renders a keyboard-operable button with disclosure state and controlled content", () => {
    const collapsed = render(false);
    const expanded = render(true);
    expect(collapsed).toContain('type="button"');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('aria-controls="account-settings-information"');
    expect(collapsed).toContain('id="account-settings-information"');
    expect(collapsed).toContain('hidden=""');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).not.toContain('hidden=""');
    expect(expanded).toContain('href="/account"');
  });
});
