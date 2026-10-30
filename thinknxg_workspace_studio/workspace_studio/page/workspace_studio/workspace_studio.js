frappe.pages['workspace-studio'].on_page_load = async wrapper => {
    frappe.ui.make_app_page({parent:wrapper,title:__('Workspace Studio'),single_column:true});
    await frappe.require([
        '/assets/thinknxg_workspace_studio/css/workspace_studio.css',
        '/assets/thinknxg_workspace_studio/js/designer_model.js'
    ]);
    const M = window.WorkspaceStudioModel, root = $(wrapper).find('.layout-main-section');
    const esc = x => frappe.utils.escape_html(String(x ?? ''));
    const call = async (method,args={}) => (await frappe.call({method:'thinknxg_workspace_studio.api.'+method,args})).message;
    let state = M.load(), current = null, selected = null, surface = 'workspace', preview = false, dirty = false, busy = false, scope = 'Global', boot;
    const labels = {workspace:'Workspace',sidebar:'Sidebar',dock:'Dock',desktop:'Desktop Icons'};
    root.html(`<div class="wss-head"><div><h2>thinkNXG Workspace Studio</h2><p>Design your ERPNext workspace visually</p><span id="wss-status" role="status"></span></div><div>
        <button class="btn btn-default" id="wss-history">History / Rollback</button>
        <button class="btn btn-default" id="wss-preview">Preview</button>
        <button class="btn btn-default" id="wss-validate">Validate</button>
        <button class="btn btn-default" id="wss-publish" disabled>Publish</button>
        <button class="btn btn-primary" id="wss-save" disabled>Save</button></div></div>
        <div class="wss-fields"><label>Workspace title<input id="wss-title" class="form-control"></label><label>Module (required)<select id="wss-module" class="form-control" required aria-required="true"></select></label><label>Native workspace<select id="wss-target" class="form-control"></select></label><label>Studio design<select id="wss-existing" class="form-control"></select></label></div>
        <nav class="wss-tabs" aria-label="Design surface">${Object.entries(labels).map(([key,label])=>`<button class="btn btn-default" data-surface="${key}">${label}</button>`).join('')}</nav>
        <div id="wss-errors" role="alert"></div><div class="wss-layout"><aside class="wss-panel wss-edit"><h4>Components</h4><p>Drag onto the canvas, or click to add.</p><div id="wss-palette"></div><div id="wss-surface-options"></div></aside><main class="wss-panel"><h4 id="wss-canvas-title"></h4><p id="wss-help"></p><div id="wss-canvas" class="wss-canvas"></div></main><aside class="wss-panel wss-edit"><h4>Properties</h4><div id="wss-properties"></div></aside></div>`);
    const list = (create=false) => M.rows(state,surface,create);
    function changed() { dirty=true; root.find('#wss-status').text('Unsaved changes'); }
    function errors() {
        const result=M.validate(state);
        if (!String(root.find('#wss-title').val() || '').trim()) result.unshift('Workspace title required');
        const module=root.find('#wss-module').val();
        if (!module) result.push('Select a Module before saving or publishing.');
        else if (!boot.modules.includes(module)) result.push('The saved Module is unavailable. Choose an existing Module.');
        root.find('#wss-module').attr('aria-invalid', !module || !boot.modules.includes(module) ? 'true' : 'false');
        root.find('#wss-errors').html(result.length ? '<ul>'+result.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>' : '');
        return result;
    }
    function control(parent, df, value, onChange) {
        let initializing=true;
        const ctl=frappe.ui.form.make_control({parent,df:{...df,change:()=>{if(!initializing){onChange(ctl.get_value());changed();drawCanvas();}}},render_input:true});
        Promise.resolve(ctl.set_value(value ?? '')).then(()=>{initializing=false;},()=>{initializing=false;});
        return ctl;
    }
    function renderOptions() {
        const host=root.find('#wss-surface-options').empty();
        if (surface === 'sidebar') control(host,{fieldtype:'Data',label:'Sidebar title'},state.navigation.title,v=>state.navigation.title=v);
        if (surface === 'dock') control(host,{fieldtype:'Data',label:'Application'},state.dock.app || 'erpnext',v=>state.dock.app=v);
        if (surface !== 'workspace') {
            const object=surface === 'sidebar' ? state.navigation : state.dock;
            const key=surface === 'sidebar' ? 'items' : surface === 'dock' ? 'entries' : 'desktop_icons';
            control(host,{fieldtype:'Check',label:'Publish this surface'},key in object,v=>{
                if(v) object[key]=object[key] || [];
                else if (!(object[key] || []).length || window.confirm('Remove these items from this saved design? Native Desktop Icons already published will remain.')) {delete object[key];selected=null;}
                render();
            });
        }
    }
    function renderProperties() {
        const host=root.find('#wss-properties').empty(), row=list()[selected];
        if (!row) {host.text('Select an item to edit its properties.');return;}
        const workspace=surface === 'workspace', cfg=workspace ? (row.config ||= {}) : row;
        const field=(obj,key,label,type='Data',options=null) => control(host,{fieldtype:type,fieldname:key,label,...(options ? {options} : {})},obj[key],v=>obj[key]=type === 'Int' ? Number(v) : v);
        field(row,workspace || surface === 'dock' ? 'title' : 'label','Title');
        if (workspace) {
            field(cfg,'col','Width (1–12 columns)','Int');
            if (row.type === 'heading') field(cfg,'level','Heading level','Select',['1','2','3','4','5','6'].join('\n'));
            if (row.type === 'text') field(row,'description','Text','Small Text');
            const selector={chart:['chart_name','Dashboard Chart'],number_card:['number_card_name','Number Card'],quick_list:['quick_list_name','DocType']}[row.type];
            if (selector) field(cfg,selector[0],selector[1],'Link',selector[1]);
            if (!M.types.includes(row.type)) host.append('<p>Unsupported component preserved. Remove it or use a supported component before publishing.</p>');
        }
        if (!workspace || row.type === 'shortcut') {
            const typeKey=surface === 'sidebar' ? 'type' : 'link_type';
            const supported=boot?.capabilities?.link_types?.[surface] || [];
            const type=cfg[typeKey] || supported[0] || 'DocType';
            const options=Array.from(new Set([...(supported.length ? supported : ['DocType','Report','Page','Workspace','Dashboard','URL']),type])).join('\n');
            control(host,{fieldtype:'Select',label:'Link type',options},type,v=>{cfg[typeKey]=v;cfg.link_to='';renderProperties();});
            const destinationType=surface==='desktop' && type==='Workspace Sidebar' ? 'Workspace' : type;
            field(cfg,'link_to','Destination',['URL','External'].includes(type) ? 'Data' : 'Link',['URL','External'].includes(type) ? null : destinationType);
            if (!workspace) field(row,'icon','Icon');
            if (surface === 'dock') field(row,'sidebar','Sidebar / module');
            if (surface === 'sidebar' || surface === 'desktop') field(row,'hidden','Hidden','Check');
        }
        const actions=$('<div class="wss-actions"></div>').appendTo(host);
        const button=(label,fn)=>$('<button type="button" class="btn btn-default"></button>').text(label).on('click',fn).appendTo(actions);
        button('Move up',()=>move(selected,selected-1));
        button('Move down',()=>{let end=selected+1; if(surface==='sidebar') while(end<list().length && Number(list()[end].indent||0)>Number(row.indent||0))end++; let to=end+1; if(surface==='sidebar' && list()[end]) while(to<list().length && Number(list()[to].indent||0)>Number(list()[end].indent||0))to++;move(selected,to);});
        if(surface === 'sidebar' && nestingSupported()) {
            button('Indent',()=>{M.indent(list(),selected,1);changed();render();});
            button('Outdent',()=>{M.indent(list(),selected,-1);changed();render();});
        }
        button('Delete',()=>{
            let end=selected+1;
            if(surface==='sidebar') while(end<list().length && Number(list()[end].indent||0)>Number(row.indent||0))end++;
            if(end-selected>1 && !window.confirm('Delete this item and its nested items?'))return;
            list().splice(selected,end-selected);selected=null;changed();render();
        });
    }
    function nestingSupported() {return !!boot?.capabilities?.sidebar_indent;}
    function drawCanvas() {
        const canvas=root.find('#wss-canvas').empty().toggleClass('wss-grid',surface==='workspace' || surface==='desktop');
        list().forEach((row,i)=>{
            const cfg=surface==='workspace' ? row.config || {} : row;
            const title=row.title || row.label || row.type || 'Untitled';
            const element=$('<div class="wss-block" tabindex="0" role="button"></div>').attr({'data-index':i,'draggable':!preview,'aria-label':'Select '+title}).toggleClass('selected',i===selected && !preview);
            if(surface==='workspace') element.css('grid-column','span '+Math.max(1,Math.min(12,Number(cfg.col)||4)));
            if(surface==='sidebar') element.css('margin-left',Number(row.indent||0)*22+'px');
            if(surface==='desktop') element.css('grid-column','span 3');
            element.append($('<small></small>').text(row.type || labels[surface]),$('<strong></strong>').text(title));
            if(row.type==='text') element.append($('<p></p>').text(row.description || cfg.body || ''));
            if(row.type==='chart') element.append($('<div class="wss-chart" aria-label="Chart placeholder">▂ ▅ ▃ ▇ ▄</div>'));
            if(row.type==='number_card') element.append($('<div class="wss-number">—</div>'));
            const destination=cfg.link_to || cfg.chart_name || cfg.number_card_name || cfg.quick_list_name || cfg.sidebar;
            if(destination) element.append($('<span></span>').text(destination));
            if(row.hidden) element.append($('<small></small>').text('Hidden'));
            canvas.append(element);
        });
        if(!preview) canvas.append('<div class="wss-drop-end">Drop here to append</div>');
        if(!list().length) canvas.prepend($('<p class="wss-empty"></p>').text(preview ? 'No items on this surface.' : 'Drag a component here to begin.'));
    }
    function render() {
        root.find('[data-surface]').removeClass('btn-primary').filter('[data-surface="'+surface+'"]').addClass('btn-primary');
        root.find('.wss-edit').toggle(!preview); root.find('.wss-layout').toggleClass('wss-preview',preview);
        root.find('#wss-preview').text(preview?'Exit preview':'Preview');
        root.find('#wss-canvas-title').text(labels[surface]+(preview?' preview':''));
        root.find('#wss-help').text(preview ? 'Layout preview. Charts and numbers are placeholders; native rendering depends on your installed Frappe schema.' : surface==='sidebar' ? (nestingSupported() ? 'Drag to reorder. Nested items move with their parent.' : 'Drag to reorder. Numeric nesting is unavailable in this installed Sidebar schema.') : surface==='desktop' ? 'Choose an existing Workspace. Visibility requires Desktop Settings → Desktop Icons. Removing an item here does not delete a published icon.' : 'Drop before an item to reorder, or append at the bottom.');
        const palette=root.find('#wss-palette').empty();
        (surface==='workspace'?M.types:['link']).forEach(type=>palette.append($('<button class="wss-palette-item btn btn-default" draggable="true"></button>').attr('data-type',type).text('+ '+(type==='link'?labels[surface]+' item':type.replaceAll('_',' ')))));
        renderOptions(); drawCanvas();renderProperties();
    }
    function add(type,at=list().length) {
        if(surface==='workspace' && !M.types.includes(type))return;
        const row=surface==='workspace'?{id:frappe.utils.get_random(10),type,title:type.replaceAll('_',' '),description:'',config:{col:type==='heading'||type==='text'?12:4,...(type==='shortcut'?{link_type:'DocType',link_to:''}:{})}}:surface==='sidebar'?{label:'New item',type:'DocType',link_to:'',indent:0}:surface==='dock'?{title:'New item',link_type:'DocType',link_to:''}:{label:'New icon',link_type:'DocType',link_to:''};
        if(surface !== 'workspace') {
            const key=surface === 'sidebar' ? 'type' : 'link_type';
            row[key]=boot?.capabilities?.link_types?.[surface]?.[0] || 'DocType';
        }
        list(true).splice(at,0,row);selected=at;changed();render();
    }
    function move(from,to){if(preview)return;selected=M.move(list(),from,to,surface==='sidebar');changed();render();}
    root.on('click','[data-surface]',function(){surface=$(this).attr('data-surface');selected=null;render();});
    root.on('click','.wss-palette-item',function(){if(!preview)add($(this).attr('data-type'));});
    root.on('click keydown','.wss-block',function(e){if(e.type==='keydown' && !['Enter',' '].includes(e.key))return;if(!preview){e.preventDefault();selected=Number($(this).attr('data-index'));drawCanvas();renderProperties();}});
    root.on('dragstart','.wss-block,.wss-palette-item',function(e){if(preview){e.preventDefault();return;}e.originalEvent.dataTransfer.setData('application/x-workspace-studio',JSON.stringify({surface,type:$(this).attr('data-type'),index:$(this).attr('data-index')}));});
    root.on('dragover','#wss-canvas',e=>{if(!preview)e.preventDefault();});
    root.on('drop','#wss-canvas',function(e){
        e.preventDefault();if(preview)return;
        let data;try{data=JSON.parse(e.originalEvent.dataTransfer.getData('application/x-workspace-studio'));}catch{return;}
        if(data.surface!==surface)return;
        const block=$(e.target).closest('.wss-block'),to=block.length?Number(block.attr('data-index')):list().length;
        if(data.type)add(data.type,to);else if(data.index!=null)move(Number(data.index),to);
    });
    root.find('#wss-preview').on('click',()=>{preview=!preview;render();});
    root.find('#wss-validate').on('click',()=>{if(!errors().length)frappe.show_alert({message:__('Design is valid locally; native schema checks run at publish.'),indicator:'green'});});
    root.find('#wss-title,#wss-module,#wss-target').on('change',changed);
    function working(action){return async()=>{if(busy)return;busy=true;root.find('button,input,select,textarea').prop('disabled',true);try{await action();}catch(e){frappe.msgprint(esc(e.message || 'Operation failed'));}finally{busy=false;root.find('button,input,select,textarea').prop('disabled',false);root.find('#wss-publish').prop('disabled',!boot?.can_publish);}};}
    function setModule(value) {
        const el=root.find('#wss-module');
        if(value && !el.find('option').toArray().some(option=>option.value===value)) el.append($('<option></option>').val(value).text(value+' (unavailable)'));
        el.val(value || '');
    }
    async function refresh() {
        boot=await call('bootstrap');
        const options=(id,rows,first)=>{const el=root.find(id),value=el.val();el.empty().append($('<option value=""></option>').text(first));rows.forEach(([key,label])=>el.append($('<option></option>').val(key).text(label)));el.val(value);};
        const module=root.find('#wss-module').val();
        options('#wss-module',boot.modules.map(x=>[x,x]),'Choose module');
        setModule(module);
        options('#wss-target',boot.native_workspaces.map(x=>[x.name,x.title||x.name]),'Create new workspace');
        options('#wss-existing',boot.studio_workspaces.map(x=>[x.name,x.workspace_title]),'New Studio design');
        root.find('#wss-existing').val(current || '');
    }
    async function save() {
        if(errors().length)throw Error('Correct the validation errors before saving.');
        const result=await call('save_design',{name:current,title:root.find('#wss-title').val(),module:root.find('#wss-module').val(),target_workspace:root.find('#wss-target').val(),scope,layout:JSON.stringify(state.layout),navigation:JSON.stringify(state.navigation),dock:JSON.stringify(state.dock)});
        current=result.name;dirty=false;root.find('#wss-status').text('Saved draft');await refresh();
    }
    root.find('#wss-save').on('click',working(save));
    root.find('#wss-existing').on('change',working(async()=>{
        const next=root.find('#wss-existing').val() || null;
        if(dirty && !window.confirm('Discard unsaved changes?')){root.find('#wss-existing').val(current || '');return;}
        const doc=next?await call('load',{name:next}):{};
        const loaded=M.load(doc); // Parse before replacing the active design.
        state=loaded;current=next;scope=doc.scope || 'Global';selected=null;dirty=false;
        root.find('#wss-title').val(doc.workspace_title || '');setModule(doc.module_name || '');root.find('#wss-target').val(doc.target_workspace || '');root.find('#wss-status').text(next?'Loaded':'New design');root.find('#wss-errors').empty();render();
    }));
    // The note callback saves the exact visible design before invoking the existing guarded publisher.
    root.find('#wss-publish').on('click',()=>{
        if(!boot.can_publish || errors().length)return;
        frappe.prompt([{fieldtype:'Small Text',fieldname:'note',label:'Publish note',reqd:1}],values=>working(async()=>{
            await save();const result=await call('publish',{name:current,note:values.note});
            root.find('#wss-target').val(result.workspace);root.find('#wss-status').text('Published · backup '+result.version);
            frappe.msgprint(__('Published workspace {0}. Backup version: {1}',[esc(result.workspace),esc(result.version)]));
        })(),__('Publish to native ERPNext'),__('Publish'));
    });
    root.find('#wss-history').on('click',working(async()=>{
        if(!current)throw Error('Save a design first.');
        const versions=await call('versions',{name:current});
        const dlg=new frappe.ui.Dialog({title:__('Native backups'),fields:[{fieldtype:'HTML',fieldname:'history'}]});
        const host=dlg.fields_dict.history.$wrapper;
        versions.forEach(v=>{
            const line=$('<p></p>').text('#'+v.version_number+' · '+v.action+' · '+v.change_summary+' ');
            if(v.action==='Published') $('<button class="btn btn-default">Rollback</button>').on('click',()=>frappe.confirm(__('Restore this native backup? Later manual changes will be checked before restoring.'),()=>working(async()=>{
                const result=await call('rollback',{version_name:v.name,note:'Restored from visual designer'});dlg.hide();frappe.msgprint(__('Restored {0} native documents.',[result.restored]));root.find('#wss-status').text('Native backup restored; design remains a draft');
            })())).appendTo(line);
            host.append(line);
        });if(!versions.length)host.text('No saved versions.');dlg.show();
    }));
    try {await refresh();root.find('#wss-save').prop('disabled',false);root.find('#wss-publish').prop('disabled',!boot.can_publish).attr('title',boot.can_publish?'Publish saved design':'Enable guarded publishing in Studio Settings');render();}
    catch(e){root.find('#wss-errors').text(e.message || 'Unable to load Workspace Studio.');}
};
