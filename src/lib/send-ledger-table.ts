import { Prisma } from "@prisma/client";

const SEND_LEDGER_MIGRATION = "20260524090000_send_ledger";

let didWarnMissingSendLedgerTable = false;

export function isMissingSendLedgerTableError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2021") {
    return false;
  }

  const table = typeof error.meta?.table === "string" ? error.meta.table : "";
  const modelName = typeof error.meta?.modelName === "string" ? error.meta.modelName : "";
  const message = error.message ?? "";

  return [table, modelName, message].some((value) => value.includes("SendLedger"));
}

export function warnMissingSendLedgerTable() {
  if (process.env.NODE_ENV === "test" || didWarnMissingSendLedgerTable) {
    return;
  }

  didWarnMissingSendLedgerTable = true;
  console.warn(
    `[send-ledger] SendLedger table is missing. Apply Prisma migration ${SEND_LEDGER_MIGRATION}; Gmail send safety tracking is paused until the ledger is available.`
  );
}
