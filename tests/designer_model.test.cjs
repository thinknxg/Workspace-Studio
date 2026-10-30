const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../thinknxg_workspace_studio/public/js/designer_model.js');
const M = globalThis.WorkspaceStudioModel;
test('legacy schemas and unknown configuration survive round trip',()=>{
 const doc={layout_json:JSON.stringify({version:1,custom:{x:1},components:[{type:'shortcut',title:'Orders',config:{link_to:'Sales Order',filters:{status:'Open'}}}]}),navigation_json:'{"extra":true}',dock_json:'{"app":"erpnext","extra":42,"desktop_icons":[]}'};
 const state=M.load(doc);assert.equal(M.validate(state).length,0);assert.equal(state.layout.components[0].config.filters.status,'Open');assert.equal(state.dock.extra,42);assert.equal('items' in state.navigation,false);assert.equal('entries' in state.dock,false);
});
test('palette append activates only the requested surface',()=>{const s=M.load();M.rows(s,'desktop',true).push({label:'Sales',link_type:'Workspace',link_to:'Sales'});assert.equal(s.dock.desktop_icons.length,1);assert.equal('entries' in s.dock,false);});
test('flat reorder supports before and append',()=>{const a=['a','b','c'];assert.equal(M.move(a,0,3),2);assert.deepEqual(a,['b','c','a']);M.move(a,2,0);assert.deepEqual(a,['a','b','c']);});
test('sidebar subtree moves as a unit and rejects a self drop',()=>{const a=[{label:'a',indent:0},{label:'b',indent:1},{label:'c',indent:2},{label:'d',indent:0}];M.move(a,0,2,true);assert.equal(a[0].label,'a');M.move(a,0,4,true);assert.deepEqual(a.map(x=>x.label),['d','a','b','c']);});
test('moving nested item first normalizes its subtree depth',()=>{const a=[{indent:0},{indent:1},{indent:2}];M.move(a,1,0,true);assert.deepEqual(a.map(x=>x.indent),[0,1,0]);});
test('indent and outdent include descendants and reject first-row indent',()=>{const a=[{indent:0},{indent:0},{indent:1}];M.indent(a,0,1);assert.equal(a[0].indent,0);M.indent(a,1,1);assert.deepEqual(a.map(x=>x.indent),[0,1,2]);M.indent(a,1,-1);assert.deepEqual(a.map(x=>x.indent),[0,0,1]);});
test('required shortcuts and selectors block publication',()=>{const s=M.load();s.layout.components=[{type:'shortcut',title:'Orders',config:{}},{type:'chart',config:{}},{type:'number_card',config:{}}];assert.equal(M.validate(s).length,3);});
test('invalid width, duplicate icon titles, unsafe URLs and nesting are rejected',()=>{const s=M.load();s.layout.components=[{type:'spacer',config:{col:99}}];s.dock.desktop_icons=[{label:'X',link_to:'Sales'},{label:'X',link_to:'Sales'}];s.navigation.items=[{label:'Bad',type:'URL',link_to:'javascript:alert(1)',indent:2}];assert.equal(M.validate(s).length,4);});
test('malformed section arrays fail before replacing active state',()=>{assert.throws(()=>M.load({dock_json:'{"desktop_icons":{}}'}));assert.throws(()=>M.load({layout_json:'broken'}));});
test('drop index works for vertical lists, horizontal bars and wrapping grids',()=>{
 const v=[{left:0,right:100,top:0,bottom:40},{left:0,right:100,top:50,bottom:90}];
 assert.equal(M.dropIndex(v,{x:10,y:5},'vertical'),0);assert.equal(M.dropIndex(v,{x:10,y:30},'vertical'),1);assert.equal(M.dropIndex(v,{x:10,y:200},'vertical'),2);
 const h=[{left:0,right:50,top:0,bottom:50},{left:60,right:110,top:0,bottom:50}];
 assert.equal(M.dropIndex(h,{x:40,y:10},'horizontal'),1);assert.equal(M.dropIndex(h,{x:5,y:10},'horizontal'),0);
 const g=[{left:0,right:100,top:0,bottom:50},{left:110,right:210,top:0,bottom:50},{left:0,right:100,top:60,bottom:110}];
 assert.equal(M.dropIndex(g,{x:150,y:20},'grid'),1);assert.equal(M.dropIndex(g,{x:190,y:20},'grid'),2);assert.equal(M.dropIndex(g,{x:10,y:80},'grid'),2);assert.equal(M.dropIndex(g,{x:90,y:80},'grid'),3);assert.equal(M.dropIndex(g,{x:5,y:5},'grid'),0);
});
test('resize converts pixels to 1–12 columns',()=>{assert.equal(M.columnsFor(290,100,10),3);assert.equal(M.columnsFor(5,100,10),1);assert.equal(M.columnsFor(5000,100,10),12);});
test('sidebar drop nests by pointer depth, clamps, and moves subtrees',()=>{
 const a=[{label:'a',indent:0},{label:'b',indent:0},{label:'c',indent:1}];
 assert.equal(M.sidebarDrop(a,null,1,5,{label:'n'}),1);assert.deepEqual(a.map(x=>x.label+x.indent),['a0','n1','b0','c1']);
 M.sidebarDrop(a,2,1,0);assert.deepEqual(a.map(x=>x.label+x.indent),['a0','b0','c1','n1']);
 // dragging a row right within its own place nests it under the previous row
 M.sidebarDrop(a,1,1,1);assert.deepEqual(a.map(x=>x.label+x.indent),['a0','b1','c2','n2']);
 assert.equal(M.validate({layout:{components:[]},navigation:{items:a.map(x=>({...x,type:'DocType',link_to:'X'}))},dock:{}}).length,0);
 M.sidebarDrop(a,0,0,3);assert.equal(a[0].indent,0);
});
test('duplicate copies a subtree with fresh ids after the original',()=>{
 const w=[{id:'x',type:'shortcut',title:'Orders',config:{link_to:'Sales Order'}}];assert.equal(M.duplicate(w,0),1);assert.notEqual(w[1].id,'x');assert.equal(w[1].title,'Orders (copy)');w[1].config.link_to='Changed';assert.equal(w[0].config.link_to,'Sales Order');
 const s=[{label:'p',indent:0},{label:'c',indent:1},{label:'q',indent:0}];assert.equal(M.duplicate(s,0,true),2);assert.deepEqual(s.map(x=>x.indent),[0,1,0,1,0]);
});
test('history undoes and redoes serialised states',()=>{const h=M.history(2);h.record('a');h.record('b');h.record('c');assert.equal(h.undo('d'),'c');assert.equal(h.undo('c'),'b');assert.equal(h.undo('b'),null);assert.equal(h.redo('b'),'c');h.record('x');assert.equal(h.canRedo,false);});
test('audience validation requires a matching target for scoped designs',()=>{
 assert.deepEqual(M.validateAssignments('Global',[]),[]);
 assert.equal(M.validateAssignments('Role',[]).length,1);
 assert.equal(M.validateAssignments('Role',[{target_type:'Role',target_name:'Sales User',enabled:1}]).length,0);
 assert.equal(M.validateAssignments('Role',[{target_type:'Role',target_name:'',enabled:1},{target_type:'Galaxy',target_name:'x'}]).length,3);
});
