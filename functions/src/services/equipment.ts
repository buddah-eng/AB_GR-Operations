/**
 * Equipment Service
 *
 * Checkout, return, overdue tracking, and venue-based queries
 * for the equipment table.
 */

import { query } from "../db/client";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface Equipment {
  readonly [key: string]: unknown;
  id: string;
  name: string;
  category: string | null;
  venue_id: string | null;
  status: string;
  checked_out_to: string | null;
  checked_out_at: string | null;
  due_back_at: string | null;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

// --- Service functions ---

/**
 * Check out a piece of equipment to a staff member.
 * Sets status to 'checked_out' with checkout timestamp and due-back time.
 */
export async function checkoutEquipment(
  equipmentId: string,
  staffId: string,
  dueBackAt: string
): Promise<Equipment | null> {
  const result = await query<Equipment>(
    `UPDATE equipment
     SET status = 'checked_out',
         checked_out_to = $1,
         checked_out_at = now(),
         due_back_at = $2,
         updated_at = now()
     WHERE id = $3 AND status = 'available' AND archived = false
     RETURNING *`,
    [staffId, dueBackAt, equipmentId]
  );

  if (result.rows.length === 0) {
    logger.warn("checkoutEquipment: equipment not available", { equipmentId, staffId });
    return null;
  }

  logger.info("Equipment checked out", { equipmentId, staffId, dueBackAt });
  return result.rows[0];
}

/**
 * Return a piece of equipment. Resets checkout fields
 * and sets status back to 'available'.
 */
export async function returnEquipment(equipmentId: string): Promise<Equipment | null> {
  const result = await query<Equipment>(
    `UPDATE equipment
     SET status = 'available',
         checked_out_to = NULL,
         checked_out_at = NULL,
         due_back_at = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'checked_out'
     RETURNING *`,
    [equipmentId]
  );

  if (result.rows.length === 0) {
    logger.warn("returnEquipment: equipment not checked out", { equipmentId });
    return null;
  }

  logger.info("Equipment returned", { equipmentId });
  return result.rows[0];
}

/**
 * Find all equipment that is checked out and past its due_back_at time.
 */
export async function getOverdueEquipment(): Promise<Equipment[]> {
  const result = await query<Equipment>(
    `SELECT * FROM equipment
     WHERE status = 'checked_out'
       AND due_back_at < now()
       AND archived = false
     ORDER BY due_back_at ASC`
  );

  return result.rows;
}

/**
 * List all equipment assigned to a specific venue.
 */
export async function listEquipmentByVenue(venueId: string): Promise<Equipment[]> {
  const result = await query<Equipment>(
    `SELECT * FROM equipment
     WHERE venue_id = $1 AND archived = false
     ORDER BY name ASC`,
    [venueId]
  );

  return result.rows;
}
