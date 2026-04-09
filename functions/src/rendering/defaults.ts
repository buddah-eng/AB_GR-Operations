/**
 * Default Form/View Generation
 *
 * Generates sensible default FormConfig and ViewConfig from ontology
 * properties when the builder has not created a custom layout.
 * Also exports the property-type-to-input and property-type-to-column
 * mapping tables used by the rendering engine.
 */

import { getPropertiesForConcept } from "../ontology/loader";
import type {
  Property,
  PropertyType,
  FormConfig,
  FormFieldConfig,
  ViewConfig,
  ViewColumn,
} from "../ontology/types";

// --- Input type mapping (§1) ---

export type InputType =
  | "text_input"
  | "rich_text_editor"
  | "number_input"
  | "select_dropdown"
  | "multi_select_dropdown"
  | "date_picker"
  | "datetime_picker"
  | "checkbox"
  | "url_input"
  | "email_input"
  | "phone_input"
  | "relation_picker"
  | "formula_display"
  | "rollup_display"
  | "file_upload"
  | "people_picker"
  | "status_select";

/**
 * Maps each of the 17 ontology property types to a form input component.
 */
export const PROPERTY_TO_INPUT_MAP: Readonly<Record<PropertyType, InputType>> = {
  text: "text_input",
  rich_text: "rich_text_editor",
  number: "number_input",
  select: "select_dropdown",
  multi_select: "multi_select_dropdown",
  date: "date_picker",
  datetime: "datetime_picker",
  checkbox: "checkbox",
  url: "url_input",
  email: "email_input",
  phone: "phone_input",
  relation: "relation_picker",
  formula: "formula_display",
  rollup: "rollup_display",
  files: "file_upload",
  people: "people_picker",
  status: "status_select",
};

// --- Column renderer mapping (§2) ---

export type ColumnRenderer =
  | "text_cell"
  | "rich_text_cell"
  | "number_cell"
  | "badge_cell"
  | "multi_badge_cell"
  | "date_cell"
  | "datetime_cell"
  | "checkbox_cell"
  | "link_cell"
  | "email_cell"
  | "phone_cell"
  | "relation_cell"
  | "formula_cell"
  | "rollup_cell"
  | "file_cell"
  | "avatar_cell"
  | "status_cell";

/**
 * Maps each of the 17 ontology property types to a table column renderer.
 */
export const PROPERTY_TO_COLUMN_MAP: Readonly<Record<PropertyType, ColumnRenderer>> = {
  text: "text_cell",
  rich_text: "rich_text_cell",
  number: "number_cell",
  select: "badge_cell",
  multi_select: "multi_badge_cell",
  date: "date_cell",
  datetime: "datetime_cell",
  checkbox: "checkbox_cell",
  url: "link_cell",
  email: "email_cell",
  phone: "phone_cell",
  relation: "relation_cell",
  formula: "formula_cell",
  rollup: "rollup_cell",
  files: "file_cell",
  people: "avatar_cell",
  status: "status_cell",
};

// --- Read-only display types (formula, rollup) ---

const READ_ONLY_TYPES: ReadonlySet<PropertyType> = new Set([
  "formula",
  "rollup",
]);

// --- Default form generation (§3) ---

/**
 * Generates a default FormConfig for a concept by including all non-hidden
 * properties in sort_order, single-column layout, with required fields marked.
 */
export async function generateDefaultForm(
  conceptKey: string
): Promise<FormConfig> {
  const properties = await getPropertiesForConcept(conceptKey);

  const fields: FormFieldConfig[] = properties
    .filter((p) => !p.hidden)
    .filter((p) => !READ_ONLY_TYPES.has(p.type))
    .map((p) => ({
      propertyKey: p.key,
      colSpan: 1 as const,
    }));

  return {
    id: `default-form-${conceptKey}`,
    conceptKey,
    name: "default",
    fields,
    layout: "single",
  };
}

// --- Default view generation (§3) ---

const MAX_DEFAULT_COLUMNS = 6;

/**
 * Generates a default ViewConfig (table) for a concept:
 * - First 6 non-hidden properties as columns
 * - Status column included if it exists (within the 6)
 * - Default sort by created_at DESC
 */
export async function generateDefaultView(
  conceptKey: string
): Promise<ViewConfig> {
  const properties = await getPropertiesForConcept(conceptKey);
  const visible = properties.filter((p) => !p.hidden);

  const statusProp = visible.find((p) => p.type === "status");
  const nonStatusVisible = visible.filter((p) => p.type !== "status");

  const selected: Property[] = [];

  // Take up to MAX_DEFAULT_COLUMNS - 1 non-status, then add status if exists
  if (statusProp) {
    const take = Math.min(
      nonStatusVisible.length,
      MAX_DEFAULT_COLUMNS - 1
    );
    selected.push(...nonStatusVisible.slice(0, take));
    selected.push(statusProp);
  } else {
    selected.push(...nonStatusVisible.slice(0, MAX_DEFAULT_COLUMNS));
  }

  const columns: ViewColumn[] = selected.map((p) => ({
    propertyKey: p.key,
    sortable: true,
    filterable: p.type === "select" || p.type === "status" || p.type === "multi_select",
  }));

  return {
    id: `default-view-${conceptKey}`,
    conceptKey,
    name: "default",
    viewType: "table",
    columns,
    sort: {
      field: "created_at",
      direction: "desc",
    },
    rowAction: "navigate_to_detail",
  };
}
