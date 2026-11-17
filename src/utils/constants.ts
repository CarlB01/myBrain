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
  
  // Core application visual node icon
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
  // Tier Collections & Column Flow Wrappers
  // ==========================================================================
  COLLECTION_WRAPPER: 'rv-collection-wrapper',
  COLLECTION: 'rv-collection',
  COL_WRAPPER: 'rv-columns-wrapper',
  GROUPS: 'rv-groups',

  // ==========================================================================
  // Hyperlink Anatomy & Target Node Classes
  // ==========================================================================
  LINKDIV: 'rv-linkdiv',
  
  /* 
   * Primary downstream tracking anchor class for myBrain active nodes.
   */
  A: 'rv-node-link',
  
  /*
   * Retained for backward parsing safety if referenced elsewhere in legacy files.
   */
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

  // Coordinates mathematical rendering factor
  FACTOR: 1,

  // Empty view state instructional text
  WELCOME: 'Please allow obsidian some time to prepare the files! \n'
      + 'To view graph, please open one of your notes.',

} as const;

/**
 * Explicit Type Declaration mapping the frozen constant dictionary layout.
 * Guarantees compile-time type exhaustiveness across modular file imports.
 */
export type RVConstants = typeof RV;
