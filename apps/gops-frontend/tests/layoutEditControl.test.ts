import assert from "node:assert/strict";
import { createLayoutEditControl } from "../src/layout/layoutEditControl";

let enterCount = 0;
let exitCount = 0;
const enter = () => { enterCount += 1; };
const exit = () => { exitCount += 1; };

const inactiveControl = createLayoutEditControl(false, enter, exit);
assert.equal(inactiveControl.label, "레이아웃 수정모드 시작");
assert.equal(inactiveControl.pressed, false);
inactiveControl.onClick();
assert.equal(enterCount, 1);
assert.equal(exitCount, 0);

const activeControl = createLayoutEditControl(true, enter, exit);
assert.equal(activeControl.label, "레이아웃 수정모드 종료");
assert.equal(activeControl.pressed, true);
activeControl.onClick();
assert.equal(enterCount, 1);
assert.equal(exitCount, 1);

