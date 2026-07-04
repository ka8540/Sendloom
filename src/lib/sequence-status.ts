export function formatSequenceStatus(status?: string | null): string {
  if (!status) {
    return "Not set";
  }

  if (status === "WAITING_FOR_SLOT") {
    return "Waiting for slot";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
