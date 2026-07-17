"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { hasImportWorkflowContext } from "@/components/imports-workflow-selection";
import {
  getDefaultBackFallback,
  getSequenceDetailReturnTo,
  shouldUseBrowserBack,
  type AppFallbackHref
} from "@/lib/back-navigation";

type BackButtonProps = {
  alwaysUseFallback?: boolean;
  className?: string;
  fallbackHref?: AppFallbackHref;
  label?: string;
};

export function BackButton({ alwaysUseFallback = false, className, fallbackHref, label = "Go back" }: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCreateSequencePage = pathname === "/campaigns/new" || pathname === "/sequences/new";
  const isTemplateWizardPage = pathname === "/templates" && searchParams.get("wizard") === "template";
  const isImportsWorkflowPage = pathname === "/imports" && hasImportWorkflowContext(searchParams);
  const resolvedLabel = isCreateSequencePage
    ? "Back to sequences"
    : isTemplateWizardPage
      ? "Back to templates"
      : isImportsWorkflowPage
        ? "Back to imports"
        : label;

  // How many in-app client navigations have happened since this button mounted.
  // The back button lives in the persistent app shell, so this ref survives every
  // app-to-app navigation and tells us whether router.back() can safely return to
  // a real previous in-app page instead of leaving the app.
  const navigationDepthRef = useRef(0);
  const initializedRef = useRef(false);
  const poppedRef = useRef(false);

  useEffect(() => {
    if (alwaysUseFallback) {
      return;
    }

    // A popstate (browser/our own back or forward) means the upcoming pathname
    // change is not a forward push, so we should not count it as new depth.
    const handlePopState = () => {
      poppedRef.current = true;
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [alwaysUseFallback]);

  useEffect(() => {
    if (alwaysUseFallback) {
      return;
    }

    if (!initializedRef.current) {
      // First pathname seen by this button is the entry point — nothing to go
      // back to within the app yet.
      initializedRef.current = true;
      return;
    }

    if (poppedRef.current) {
      poppedRef.current = false;
      navigationDepthRef.current = Math.max(0, navigationDepthRef.current - 1);
      return;
    }

    navigationDepthRef.current += 1;
  }, [alwaysUseFallback, pathname]);

  const handleClick = useCallback(() => {
    if (isTemplateWizardPage) {
      router.push("/templates");
      return;
    }

    if (isCreateSequencePage) {
      router.push("/sequences");
      return;
    }

    // The Imports workflow (Upload / Map fields / Review) always exits to the
    // imports library, never to wherever the user came from (e.g. Discover).
    // `replace` (matching the workflow's own exit in imports-workspace) consumes
    // the workflow entry: a later back press then leaves Imports instead of
    // dropping the user back into the workflow they just exited.
    if (isImportsWorkflowPage) {
      router.replace("/imports");
      return;
    }

    const sequenceReturnTo =
      typeof window === "undefined"
        ? null
        : getSequenceDetailReturnTo(pathname, new URLSearchParams(window.location.search));
    if (sequenceReturnTo) {
      router.push(sequenceReturnTo);
      return;
    }

    if (
      typeof window !== "undefined" &&
      shouldUseBrowserBack({ alwaysUseFallback, navigationDepth: navigationDepthRef.current })
    ) {
      router.back();
      return;
    }

    router.push(fallbackHref ?? getDefaultBackFallback(pathname));
  }, [alwaysUseFallback, fallbackHref, isCreateSequencePage, isImportsWorkflowPage, isTemplateWizardPage, pathname, router]);

  return (
    <button
      aria-label={resolvedLabel}
      className={`back-button${className ? ` ${className}` : ""}`}
      title={resolvedLabel}
      type="button"
      onClick={handleClick}
    >
      <ArrowLeft aria-hidden="true" />
    </button>
  );
}
