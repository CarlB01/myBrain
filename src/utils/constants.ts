/**
 * Global Constants Dictionary for myBrain Graph Nodes Network.
 * Structured cleanly into architectural categories for production release.
 * Strictly strictly typed and frozen via TypeScript literal casting to ensure 0% undefined/any footprint.
 */
export const RV = {
  // ==========================================================================
  // Obsidian View Identifiers
  // ==========================================================================
  VIEW_TYPE: 'mybrain-view',
  DISPLAY_TEXT: 'myBrain',
  ICON: 'sparkle',

  // ==========================================================================
  // High-Level DOM Containers
  // ==========================================================================
  CONTAINER: 'rv-container',
  MYBRAIN_CONTAINER: 'rv-container',
  SVG_LAYER: 'rv-svg-layer',
  
  // ==========================================================================
  // Network Graph Area Quadrants
  // ==========================================================================
  AREA_CENTER: 'rv-area center',
  AREA_LEFT: 'rv-area left',
  AREA_RIGHT: 'rv-area right',
  AREA_TOP: 'rv-area upper',
  AREA_BOTTOM: 'rv-area lower',
  
  // ==========================================================================
  // Column Flow & Nodes
  // ==========================================================================
  COLUMNS: 'rv-columns',
  COLLECTION_START: 'rv-collection-start',
  FIRST_IN_GROUP: 'rv-first-in-group',
  ITEM: 'item',
  LINKDIV: 'rv-linkdiv',
  A: 'rv-node-link',
  SPAN: 'rv-text-span',

  // ==========================================================================
  // Interactive Controls, Toggles & Badges
  // ==========================================================================
  INFO_BTN: 'rv-info-button',
  INFO_HOVER: 'rv-info-hover',
  PLUS_MINUS_BTN: 'rv-plusminus',
  BORDERED: 'bordered-div',
  ROUNDED: 'rounded-div',
  MINUS: '−',
  PLUS: '+',

  // Geometrical vector docking connectors
  GATE_SVG: 'rv-gate-svg',
  
  // ==========================================================================
  // Dataset Responsive Reflow Properties
  // ==========================================================================
  LEFT_TALL: 'data-left-tall',
  RIGHT_TALL: 'data-right-tall',
  FACTOR: 1,

  // Empty view state instructional text
  WELCOME: 'Please allow obsidian some time to prepare the files! \n'
      + 'To view graph, please open one of your notes.',

} as const;

export type RVConstants = typeof RV;
