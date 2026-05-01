import type { ManualConfig } from "@/components/manual/manualTypes";

export const finderManual: ManualConfig = {
  id: "finder",
  routeLabel: "Finder",
  steps: [
    {
      id: "search-mode",
      title: "Find missing emails",
      body: "Use Finder when an imported list has names and companies but not usable addresses. Search by person plus domain, or switch to domain search for broader company discovery.",
      selector: "[role='tablist'][aria-label='Hunter search modes']",
      placement: "bottom"
    },
    {
      id: "person-domain",
      title: "Person lookup",
      body: "For a direct email match, enter the full name and company domain. Sendloom asks Hunter, then keeps the result ready to copy into your sourcing workflow.",
      selector: "input[placeholder='Alexis Ohanian'], input[placeholder='reddit.com']",
      placement: "right"
    },
    {
      id: "api-key",
      title: "API key lives server-side",
      body: "The Hunter key is encrypted and stored server-side. If search is unavailable, open settings here first and save the key before running lookups.",
      selector: "button",
      placement: "bottom"
    },
    {
      id: "history",
      title: "Reuse search history",
      body: "Domain searches are saved so operators can return to a company list, filter departments, select contacts, and export without repeating the lookup.",
      selector: "section[aria-label='Saved domain searches']",
      placement: "left"
    }
  ]
};
