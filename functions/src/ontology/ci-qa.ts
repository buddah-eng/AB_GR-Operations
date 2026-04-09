/**
 * Ontology CI/QA Pipeline
 *
 * Validation and review system that governs all ontology config changes.
 * Implements a change-request state machine, validation engine,
 * impact analysis, and review gates.
 *
 * Lifecycle: DRAFT -> VALIDATE -> REVIEW -> STAGE -> APPLY
 *                                                  -> ROLLBACK (within 24hr)
 */

import { query } from "../db/client";
import { updateOntologyRecord } from "../versioning/service";
import * as logger from "firebase-functions/logger";

// --- Constants ---

const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const ADMIN_PRIORITY_THRESHOLD = 10;
const DIRECTOR_PRIORITY_THRESHOLD = 20;

const REQUIRED_CONCEPT_FIELDS = ["key", "name"];
const REQUIRED_PROPERTY_FIELDS = ["key", "label", "type", "conceptKey"];

const VALID_PROPERTY_TYPES = [
  "text", "rich_text", "number", "select", "multi_select",
  "date", "datetime", "checkbox", "url", "email", "phone",
  "relation", "formula", "rollup", "files", "people", "status",
] as const;

const CONFIG_TABLES = ["form_configs", "view_configs", "workflow_configs"] as const;

// --- Types ---

export type ChangeRequestStatus =
  | "draft"
  | "validating"
  | "review"
  | "staged"
  | "applied"
  | "rolled_back"
  | "rejected";

export type RiskLevel = "low" | "medium" | "high";

export type ChangeType = "additive" | "modification" | "deletion";

export interface ChangeRequest {
  readonly id: string;
  readonly status: ChangeRequestStatus;
  readonly tableName: string;
  readonly recordKey: string;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly ownerScope: "org" | "department";
  readonly ownerDepartment?: string;
  readonly createdBy: string;
  readonly riskLevel: RiskLevel;
  readonly validationErrors: ReadonlyArray<string>;
  readonly impactReport?: ImpactReport;
  readonly appliedAt?: string;
  readonly changeSet?: string;
}

export interface ImpactReport {
  readonly affectedRecordCount: number;
  readonly affectedConfigs: ReadonlyArray<{
    readonly type: string;
    readonly name: string;
    readonly id: string;
  }>;
  readonly riskLevel: RiskLevel;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly riskLevel: RiskLevel;
}

export interface ReviewRequirement {
  readonly requiresReview: boolean;
  readonly requiredPriority: number;
}

// --- Valid State Transitions ---

const VALID_TRANSITIONS: Readonly<Record<ChangeRequestStatus, ReadonlyArray<ChangeRequestStatus>>> = {
  draft: ["validating"],
  validating: ["review", "rejected"],
  review: ["staged", "rejected"],
  staged: ["applied", "rejected"],
  applied: ["rolled_back"],
  rolled_back: [],
  rejected: [],
};

// --- State Machine ---

function isValidTransition(from: ChangeRequestStatus, to: ChangeRequestStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Advance a change request through the state machine.
 *
 * Validates the transition, runs stage-specific logic, and returns
 * the updated change request (immutably).
 */
export async function advanceChangeRequest(
  request: ChangeRequest,
  targetStatus: ChangeRequestStatus,
  actorId: string,
  actorPriority: number
): Promise<ChangeRequest> {
  if (!isValidTransition(request.status, targetStatus)) {
    throw new Error(
      `Invalid transition from "${request.status}" to "${targetStatus}"`
    );
  }

  switch (targetStatus) {
    case "validating": {
      const validation = await validateChange(
        request.tableName,
        request.recordKey,
        request.changes
      );
      if (!validation.valid) {
        return {
          ...request,
          status: "rejected",
          validationErrors: validation.errors,
          riskLevel: validation.riskLevel,
        };
      }
      return {
        ...request,
        status: "validating",
        validationErrors: [],
        riskLevel: validation.riskLevel,
      };
    }

    case "review": {
      const changeType = detectChangeType(request.changes);
      const review = determineReviewRequirement(
        request.riskLevel,
        request.ownerScope,
        changeType
      );
      if (!review.requiresReview) {
        // Auto-approve: skip review, go straight to staged
        return {
          ...request,
          status: "staged",
        };
      }
      if (actorPriority > review.requiredPriority) {
        throw new Error(
          `Actor priority ${actorPriority} insufficient. Required: <= ${review.requiredPriority}`
        );
      }
      return {
        ...request,
        status: "review",
      };
    }

    case "staged": {
      return {
        ...request,
        status: "staged",
      };
    }

    case "applied": {
      const result = await updateOntologyRecord(
        request.tableName,
        request.recordKey,
        request.changes as Record<string, unknown>,
        actorId,
        `CI/QA change request ${request.id}`
      );

      if (!result.success) {
        throw new Error(
          `Failed to apply change: ${result.error.message}`
        );
      }

      return {
        ...request,
        status: "applied",
        appliedAt: new Date().toISOString(),
      };
    }

    case "rolled_back": {
      if (request.status !== "applied") {
        throw new Error("Can only roll back applied changes");
      }
      if (request.appliedAt) {
        const appliedTime = new Date(request.appliedAt).getTime();
        const now = Date.now();
        if (now - appliedTime > ROLLBACK_WINDOW_MS) {
          throw new Error(
            "Rollback window (24 hours) has expired"
          );
        }
      }
      return {
        ...request,
        status: "rolled_back",
      };
    }

    case "rejected": {
      return {
        ...request,
        status: "rejected",
      };
    }

    default: {
      throw new Error(`Unhandled target status: ${targetStatus}`);
    }
  }
}

// --- Change Type Detection ---

function detectChangeType(changes: Readonly<Record<string, unknown>>): ChangeType {
  if (changes._delete === true) {
    return "deletion";
  }
  if (changes._add === true) {
    return "additive";
  }
  return "modification";
}

// --- Validation Engine ---

/**
 * Validate a proposed change to an ontology record.
 *
 * Performs structural checks, reference checks for deletions,
 * and risk assessment.
 */
export async function validateChange(
  tableName: string,
  recordKey: string,
  changes: Readonly<Record<string, unknown>>
): Promise<ValidationResult> {
  const errors: string[] = [];
  const changeType = detectChangeType(changes);

  // --- Structural checks ---
  if (tableName === "ontology_concepts") {
    for (const field of REQUIRED_CONCEPT_FIELDS) {
      if (changeType === "additive" && !(field in changes)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  if (tableName === "ontology_properties") {
    for (const field of REQUIRED_PROPERTY_FIELDS) {
      if (changeType === "additive" && !(field in changes)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate property type enum
    const propType = changes.type;
    if (
      propType !== undefined &&
      typeof propType === "string" &&
      !(VALID_PROPERTY_TYPES as readonly string[]).includes(propType)
    ) {
      errors.push(`Invalid property type: ${propType}`);
    }
  }

  // --- Reference checks for deletions ---
  if (changeType === "deletion") {
    const refErrors = await checkReferences(tableName, recordKey);
    errors.push(...refErrors);
  }

  // --- Risk assessment ---
  const riskLevel = assessRisk(changeType, changes);

  return {
    valid: errors.length === 0,
    errors,
    riskLevel,
  };
}

// --- Reference Checking ---

async function checkReferences(
  tableName: string,
  recordKey: string
): Promise<ReadonlyArray<string>> {
  const errors: string[] = [];

  for (const configTable of CONFIG_TABLES) {
    try {
      const result = await query(
        `SELECT id, name FROM ${configTable} WHERE config::text LIKE $1`,
        [`%${recordKey}%`]
      );

      if (result.rows.length > 0) {
        for (const row of result.rows) {
          const record = row as { id: string; name: string };
          errors.push(
            `Referenced in ${configTable}: "${record.name}" (${record.id})`
          );
        }
      }
    } catch (err) {
      logger.error(`Error checking references in ${configTable}`, { error: err });
    }
  }

  return errors;
}

// --- Risk Assessment ---

function assessRisk(
  changeType: ChangeType,
  changes: Readonly<Record<string, unknown>>
): RiskLevel {
  if (changeType === "additive") {
    return "low";
  }

  if (changeType === "deletion") {
    return "high";
  }

  // Modification: check if org-wide
  if (changes.ownerScope === "org") {
    return "high";
  }

  return "medium";
}

// --- Impact Analysis ---

/**
 * Analyze the downstream impact of a proposed change.
 *
 * For deletions, counts records using the target entity and lists
 * all config objects that reference it.
 */
export async function analyzeImpact(
  tableName: string,
  recordKey: string,
  changeType: ChangeType
): Promise<ImpactReport> {
  if (changeType === "additive") {
    return {
      affectedRecordCount: 0,
      affectedConfigs: [],
      riskLevel: "low",
    };
  }

  let affectedRecordCount = 0;
  const affectedConfigs: Array<{ type: string; name: string; id: string }> = [];

  // Count domain records that use this entity
  if (tableName === "ontology_properties") {
    try {
      const result = await query(
        `SELECT COUNT(*)::int AS cnt FROM domain_records WHERE properties::text LIKE $1`,
        [`%${recordKey}%`]
      );
      affectedRecordCount = (result.rows[0] as { cnt: number })?.cnt ?? 0;
    } catch (err) {
      logger.error("Error counting affected domain records", { error: err });
    }
  }

  if (tableName === "ontology_concepts") {
    try {
      const result = await query(
        `SELECT COUNT(*)::int AS cnt FROM domain_records WHERE concept_key = $1`,
        [recordKey]
      );
      affectedRecordCount = (result.rows[0] as { cnt: number })?.cnt ?? 0;
    } catch (err) {
      logger.error("Error counting affected domain records", { error: err });
    }
  }

  // Check config references
  for (const configTable of CONFIG_TABLES) {
    try {
      const result = await query(
        `SELECT id, name FROM ${configTable} WHERE config::text LIKE $1`,
        [`%${recordKey}%`]
      );

      for (const row of result.rows) {
        const record = row as { id: string; name: string };
        affectedConfigs.push({
          type: configTable,
          name: record.name,
          id: record.id,
        });
      }
    } catch (err) {
      logger.error(`Error checking impact in ${configTable}`, { error: err });
    }
  }

  const riskLevel: RiskLevel =
    changeType === "deletion" ? "high" :
    affectedRecordCount > 0 ? "medium" :
    "low";

  return {
    affectedRecordCount,
    affectedConfigs,
    riskLevel,
  };
}

// --- Review Gates ---

/**
 * Determine review requirements based on risk, scope, and change type.
 *
 * - Low risk + dept scope + additive -> auto-approve
 * - Medium risk -> dept director review (priority <= 20)
 * - High risk or org-wide -> admin review (priority <= 10)
 */
export function determineReviewRequirement(
  riskLevel: RiskLevel,
  ownerScope: "org" | "department",
  changeType: ChangeType
): ReviewRequirement {
  // Low risk + department scope + additive = auto-approve
  if (riskLevel === "low" && ownerScope === "department" && changeType === "additive") {
    return { requiresReview: false, requiredPriority: Infinity };
  }

  // High risk or org-wide = admin review
  if (riskLevel === "high" || ownerScope === "org") {
    return { requiresReview: true, requiredPriority: ADMIN_PRIORITY_THRESHOLD };
  }

  // Medium risk = director review
  return { requiresReview: true, requiredPriority: DIRECTOR_PRIORITY_THRESHOLD };
}
