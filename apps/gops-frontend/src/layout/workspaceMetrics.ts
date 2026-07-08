// Sits just below the top navigation bar's underline (which is ~5px above the 68px nav
// bottom), keeping the panels close to that line with only a small gutter-sized gap.
export const workspaceTopInset = 63;
export const bottomNavigationHeight = 60;
export const navigationGap = 8;
// Reserve enough space between the panels and the bottom bar to hold the floating tool
// and layout-palette docks so they never overlap the panels above. Reduced by 10px when
// the chat-toggle button was removed, so the panel bottom drops together with the dock
// band (kept in sync with --tool-dock-drop in styles.css).
export const treeMapHoverMetaReserve = 15;
export const workspaceBottomInset = bottomNavigationHeight + treeMapHoverMetaReserve + navigationGap;
