export const RM_FAULT_STATUSES = Object.freeze(["OPEN", "PERM. FIX", "IN PROGRESS", "REPAIRED"]);
export const RM_FAULT_PRIORITIES = Object.freeze(["HIGH", "MEDIUM", "LOW"]);

export function isFaultUpdateValid(status, priority) {
  return typeof status === "string"
    && RM_FAULT_STATUSES.includes(status)
    && typeof priority === "string"
    && RM_FAULT_PRIORITIES.includes(priority);
}
