frappe.pages['workspace-studio'].on_page_load = (wrapper) => {
    const page = frappe.ui.make_app_page({parent:wrapper,title:__('Workspace Studio'),single_column:true});
    const root = $(wrapper).find('.layout-main-section');
    let current = null, selected = null;
    let design = {version:1,components:[]};
    const escape = (x) => frappe.utils.escape_html(String(x ?? ''));
    root.html(`
      <div class="wss-head"><div><h2>thinkNXG Workspace Studio</h2><p>Native ERPNext v16 workspace designer</p></div>
      <div><button class="btn btn-default" id="wss-schema">Inspect Native Schema</button>
      <button class="btn btn-default" id="wss-publish">Publish</button>
      <button class="btn btn-primary" id="wss-save">Save</button></div></div>
      <div class="wss-fields">
        <input id="wss-title" class="form-control" placeholder="Workspace title">
        <select id="wss-module" class="form-control"><option value="">Module</option></select>
        <select id="wss-target" class="form-control"><option value="">Create new workspace</option></select>
        <select id="wss-existing" class="form-control"><option value="">New Studio design</option></select>
      </div>
      <div class="wss-layout">
        <aside class="wss-panel"><h4>Components</h4><div id="wss-palette"></div></aside>
        <main class="wss-panel"><h4>Canvas</h4><div id="wss-canvas" class="wss-canvas"></div></main>
        <aside class="wss-panel"><h4>Properties</h4><div id="wss-properties">Select a component</div>
        <h4>Navigation JSON</h4><textarea id="wss-nav" class="form-control" rows="7">{}</textarea>
        <h4>Dock JSON</h4><textarea id="wss-dock" class="form-control" rows="7">{}</textarea></aside>
      </div>`);
    const types=['heading','text','shortcut','chart','number_card','quick_list','spacer'];
    types.forEach(type => root.find('#wss-palette').append(
        `<button class="wss-palette-item btn btn-default" draggable="true" data-type="${type}">${escape(type.replace('_',' '))} ＋</button>`
    ));
    function render(){
        const canvas=root.find('#wss-canvas').empty();
        design.components.forEach((c,i)=>canvas.append(
          `<div class="wss-block" draggable="true" data-index="${i}">
            <small>${escape(c.type)}</small><strong>${escape(c.title)}</strong>
            <span class="wss-delete" data-index="${i}">×</span></div>`
        ));
        const c=design.components[selected];
        root.find('#wss-properties').html(c ?
          `<label>Title</label><input id="wss-prop-title" class="form-control" value="${escape(c.title)}">
           <label>Description</label><textarea id="wss-prop-desc" class="form-control">${escape(c.description)}</textarea>
           <label>Config JSON</label><textarea id="wss-prop-json" class="form-control" rows="8">${escape(JSON.stringify(c.config||{},null,2))}</textarea>` :
          'Select a component');
    }
    root.on('click','.wss-palette-item',function(){
        design.components.push({id:frappe.utils.get_random(10),type:$(this).data('type'),title:$(this).data('type'),description:'',config:{}});
        selected=design.components.length-1;render();
    });
    root.on('click','.wss-block',function(){selected=Number($(this).data('index'));render();});
    root.on('click','.wss-delete',function(e){e.stopPropagation();design.components.splice(Number($(this).data('index')),1);selected=null;render();});
    root.on('change','#wss-prop-title, #wss-prop-desc, #wss-prop-json',function(){
        if(selected===null)return;
        const c=design.components[selected];
        try{
            c.title=root.find('#wss-prop-title').val();
            c.description=root.find('#wss-prop-desc').val();
            c.config=JSON.parse(root.find('#wss-prop-json').val());
        }catch(e){frappe.msgprint(__('Invalid component JSON'));return;}
        render();
    });
    root.on('dragstart','.wss-block',function(e){e.originalEvent.dataTransfer.setData('reorder',$(this).data('index'));});
    root.on('dragover','#wss-canvas,.wss-block',e=>e.preventDefault());
    root.on('drop','.wss-block',function(e){
        e.preventDefault();
        const from=e.originalEvent.dataTransfer.getData('reorder'),to=Number($(this).data('index'));
        if(from!==''){
            const item=design.components.splice(Number(from),1)[0];design.components.splice(to,0,item);render();
        }
    });
    async function call(method,args={}) {
        const r=await frappe.call({method:'thinknxg_workspace_studio.api.'+method,args});return r.message;
    }
    async function refresh(){
        const data=await call('bootstrap');
        root.find('#wss-module').empty().append('<option value="">Module</option>');
        data.modules.forEach(x=>root.find('#wss-module').append(`<option>${escape(x)}</option>`));
        root.find('#wss-target').empty().append('<option value="">Create new workspace</option>');
        data.native_workspaces.forEach(x=>root.find('#wss-target').append(`<option value="${escape(x.name)}">${escape(x.title||x.name)}</option>`));
        root.find('#wss-existing').empty().append('<option value="">New Studio design</option>');
        data.studio_workspaces.forEach(x=>root.find('#wss-existing').append(`<option value="${escape(x.name)}">${escape(x.workspace_title)}</option>`));
    }
    root.find('#wss-existing').on('change',async function(){
        current=$(this).val()||null;if(!current)return;
        const d=await call('load',{name:current});
        design=JSON.parse(d.layout_json||'{"components":[]}');
        root.find('#wss-title').val(d.workspace_title);
        root.find('#wss-module').val(d.module_name);
        root.find('#wss-target').val(d.target_workspace||'');
        root.find('#wss-nav').val(d.navigation_json||'{}');
        root.find('#wss-dock').val(d.dock_json||'{}');
        selected=null;render();
    });
    root.find('#wss-save').on('click',async()=>{
        const response=await call('save_design',{
            name:current,title:root.find('#wss-title').val(),
            module:root.find('#wss-module').val(),
            target_workspace:root.find('#wss-target').val(),
            layout:JSON.stringify(design),navigation:root.find('#wss-nav').val(),
            dock:root.find('#wss-dock').val()
        });current=response.name;frappe.show_alert({message:__('Design saved'),indicator:'green'});await refresh();
    });
    root.find('#wss-publish').on('click',()=>{
        if(!current){frappe.msgprint(__('Save the design first'));return;}
        frappe.prompt([{fieldtype:'Small Text',fieldname:'note',label:'Publish note',reqd:1}],
            async values=>{const result=await call('publish',{name:current,note:values.note});
                frappe.msgprint(__('Published workspace {0}. Backup version: {1}',[result.workspace,result.version]));},
            __('Publish to native ERPNext'),__('Publish'));
    });
    root.find('#wss-schema').on('click',async()=>{
        const schemas=await call('inspect_native');
        const dlg=new frappe.ui.Dialog({title:__('Native DocType schemas'),size:'extra-large',
            fields:[{fieldtype:'Code',fieldname:'json',label:'Schema',options:'JSON'}]});
        dlg.show();dlg.set_value('json',JSON.stringify(schemas,null,2));
    });
    refresh();render();
};
