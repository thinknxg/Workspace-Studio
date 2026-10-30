window.__ = text => text;
window.__calls=[];window.__saved=null;window.__messages=[];
window.frappe={pages:{'workspace-studio':{}},utils:{escape_html:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),get_random:()=>Math.random().toString(36).slice(2)},require:async()=>{},ui:{make_app_page:()=>{},form:{make_control:({parent,df})=>{
 const wrapper=$('<label></label>').text(df.label).appendTo(parent);const el=df.fieldtype==='Select'?$('<select></select>'):(df.fieldtype==='Small Text'?$('<textarea></textarea>'):$('<input>'));el.attr('data-field',df.label).addClass('form-control').appendTo(wrapper);if(df.fieldtype==='Check')el.attr('type','checkbox');if(df.fieldtype==='Select')for(const v of df.options.split('\n'))el.append($('<option></option>').val(v).text(v));const control={set_value:v=>Promise.resolve().then(()=>{if(df.fieldtype==='Check')el.prop('checked',!!v);else el.val(v);df.change();}),get_value:()=>df.fieldtype==='Check'?(el.prop('checked')?1:0):el.val()};el.on('change',df.change);return control;
 }}},call:async({method,args})=>{
 const key=method.split('.').pop();window.__calls.push({key,args});
 if(key==='bootstrap')return {message:{modules:['Selling'],native_workspaces:[{name:'Sales',title:'Sales'}],studio_workspaces:window.__saved?[{name:'studio-test',workspace_title:window.__saved.title}]:[],capabilities:{sidebar_indent:true,link_types:{workspace:['DocType','Page','Report','URL'],sidebar:['DocType','Workspace'],dock:['Workspace','URL'],desktop:['Workspace','URL']}},can_publish:true}};
 if(key==='save_design'){window.__saved=args;return {message:{name:'studio-test'}};}
 if(key==='publish')return {message:{workspace:'Sales',version:'version-1'}};
 if(key==='load')return {message:{workspace_title:window.__saved.title,module_name:window.__saved.module,scope:'Role',layout_json:window.__saved.layout,navigation_json:window.__saved.navigation,dock_json:window.__saved.dock}};
 if(key==='versions')return {message:[]};return {message:{}};
 },msgprint:m=>window.__messages.push(m),show_alert:()=>{},prompt:(fields,callback)=>callback({note:'Browser smoke test'}),confirm:(text,callback)=>callback()};
