export type LayoutEditControl = {
  label: string;
  pressed: boolean;
  onClick: () => void;
};

export function createLayoutEditControl(
  layoutEditMode: boolean,
  onEnterLayoutEdit: () => void,
  onExitLayoutEdit: () => void
): LayoutEditControl {
  return {
    label: layoutEditMode ? "레이아웃 수정모드 종료" : "레이아웃 수정모드 시작",
    pressed: layoutEditMode,
    onClick: layoutEditMode ? onExitLayoutEdit : onEnterLayoutEdit
  };
}

