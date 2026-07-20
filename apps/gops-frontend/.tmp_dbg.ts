import { resolvePanelMoveWithPush, minGridSpanForKind, type TiledPanelState, type PanelGridRect } from "./src/layout/panelLayout";
function stateWithRects(rects: PanelGridRect[]): TiledPanelState {
  const contents: any = {}; const slots: any = rects.map((g,i)=>{const c=`content-block-${i+1}`;contents[c]={id:c,kind:"news",title:`B${i+1}`,instanceIndex:i+1};return{id:`slot-block-${i+1}`,contentId:c,gridRect:g,rect:{left:0,top:0,width:0,height:0},minWidth:0,minHeight:0};});
  return { slots, contents, nextInstance: rects.length+1 };
}
console.log("news min span:", JSON.stringify(minGridSpanForKind("news")));
const s = stateWithRects([{col:1,row:1,colSpan:2,rowSpan:2},{col:1,row:3,colSpan:2,rowSpan:2}]);
console.log("overlap:", JSON.stringify(resolvePanelMoveWithPush(s,"slot-block-1",{col:1,row:3,colSpan:2,rowSpan:2})));
const c = stateWithRects([{col:1,row:1,colSpan:2,rowSpan:2},{col:1,row:3,colSpan:2,rowSpan:1},{col:1,row:4,colSpan:2,rowSpan:1}]);
console.log("cascade:", JSON.stringify(resolvePanelMoveWithPush(c,"slot-block-1",{col:1,row:2,colSpan:2,rowSpan:2})));
