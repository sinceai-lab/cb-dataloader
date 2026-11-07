// STUB: will write dropped/flagged rows to the "anomalies" tenant so users can edit missing data later.
// Intentionally a no-op until the edit workflow is designed.
export interface Anomaly {
  loadLogId: string;
  schema: string;
  rowNumber: number;
  errors: string[];
  raw: Record<string, string>;
}

export async function sendAnomalies(_anomalies: Anomaly[]): Promise<void> {}
