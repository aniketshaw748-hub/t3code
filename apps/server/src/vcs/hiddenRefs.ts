import { BRAND } from "@t3tools/contracts/brand";

/**
 * The namespace for refs the server writes into users' repositories. Hidden from branch and tag
 * listings; derived from the brand so a renamed build keeps its refs apart from other installs.
 */
export const HIDDEN_REFS_ROOT = `refs/${BRAND.slug}`;
