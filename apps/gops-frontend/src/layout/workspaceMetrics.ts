// Sits just below the top navigation bar's underline (which is ~5px above the 68px nav
// bottom), keeping the panels close to that line with only a small gutter-sized gap.
export const workspaceTopInset = 63;
export const bottomNavigationHeight = 60;
export const navigationGap = 8;
// Reserve enough space between the panels and the bottom bar to hold the floating tool
// and layout-palette docks so they never overlap the panels above.
export const treeMapHoverMetaReserve = 25;
export const workspaceBottomInset = bottomNavigationHeight + treeMapHoverMetaReserve + navigationGap;
