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
