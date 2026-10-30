/* thinkNXG Workspace Studio — visual drag-and-drop designer for Frappe/ERPNext v16.
 *
 * Four canvases mirror the Desk surfaces they publish to: the Workspace grid,
 * the Sidebar tree, the Dock bar and the Desktop icon grid. Every property is
 * edited through structured panels; the saved JSON is never shown or typed. */
frappe.pages['workspace-studio'].on_page_load = async wrapper => {
    frappe.ui.make_app_page({parent: wrapper, title: __('Workspace Studio'), single_column: true});
    await frappe.require([
        '/assets/thinknxg_workspace_studio/css/workspace_studio.css',
        '/assets/thinknxg_workspace_studio/js/designer_model.js'
    ]);
    const M = window.WorkspaceStudioModel, root = $(wrapper).find('.layout-main-section');
    const esc = x => frappe.utils.escape_html(String(x ?? ''));
    const call = async (method, args = {}) => (await frappe.call({method: 'thinknxg_workspace_studio.api.' + method, args})).message;

    let state = M.load(), current = null, selected = null, surface = 'workspace', preview = false, device = 'desktop';
    let dirty = false, busy = false, scope = 'Global', assignments = [], wsIcon = '', boot = {modules: [], capabilities: {}};
    let dragging = null;
    const hist = M.history(80), collapsed = new WeakSet();

    const SURFACES = {
        workspace: {label: 'Workspace', glyph: 'grid', help: 'Drag components onto the grid. Drag the right edge of a block to resize it across 12 columns.'},
        sidebar: {label: 'Sidebar', glyph: 'sidebar', help: 'Drag to reorder. Drag further right while dropping to nest an item under the one above.'},
        dock: {label: 'Dock', glyph: 'dock', help: 'Drag tiles left or right to set the order of the Dock.'},
        desktop: {label: 'Desktop Icons', glyph: 'apps', help: 'Arrange the icons people see on the Desk home screen.'}
    };
    const COMPONENTS = {
        heading: {label: 'Heading', glyph: 'heading', group: 'Layout', hint: 'Section title'},
        text: {label: 'Text', glyph: 'text', group: 'Layout', hint: 'Paragraph or note'},
        spacer: {label: 'Spacer', glyph: 'spacer', group: 'Layout', hint: 'Empty gap'},
        shortcut: {label: 'Shortcut', glyph: 'shortcut', group: 'Navigation', hint: 'Card linking anywhere'},
        chart: {label: 'Chart', glyph: 'chart', group: 'Data', hint: 'Dashboard Chart'},
        number_card: {label: 'Number Card', glyph: 'number', group: 'Data', hint: 'Single KPI'},
        quick_list: {label: 'Quick List', glyph: 'list', group: 'Data', hint: 'Recent records'}
    };
    const LINK_GLYPH = {DocType: 'doc', Report: 'report', Page: 'page', Workspace: 'grid', Dashboard: 'chart', URL: 'external', External: 'external', Sidebar: 'sidebar', 'Workspace Sidebar': 'sidebar'};
    const FALLBACK_ICONS = ['accounting','assets','buying','crm','customer','dashboard','file','folder-normal','getting-started','home','hr','integration','list','loan','money-coins-1','organization','project','quality','retail','sell','setting','stock','support','tool','users','website','calendar','map','star','tag'];
    const COLOR_HEX = {grey:'#7c7c7c',gray:'#7c7c7c',green:'#30a66d',red:'#e03636',orange:'#e86c13',pink:'#e34aa6',yellow:'#c9a20a',blue:'#2490ef',cyan:'#0aa8bc',purple:'#7c4ddb',teal:'#169c8f',violet:'#7c4ddb'};
    const GLYPHS = {
        grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1.5M5.5 11h1.5"/>',
        dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="7" y="15" width="10" height="3" rx="1.2"/>',
        apps: '<circle cx="6" cy="6" r="2.2"/><circle cx="12" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="18" cy="12" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="12" cy="18" r="2.2"/>',
        heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
        text: '<path d="M4 6h16M4 10h16M4 14h11M4 18h7"/>',
        spacer: '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>',
        shortcut: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 15l6-6M10 9h5v5"/>',
        chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
        number: '<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/>',
        list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
        doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
        report: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 16v-3M12 16V9M16 16v-5"/>',
        page: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
        external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
        undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
        redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
        eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        eyeoff: '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17.6 17.6 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
        check: '<path d="M20 6L9 17l-5-5"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
        trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
        grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
        chevron: '<path d="M9 6l6 6-6 6"/>',
        arrow: '<path d="M7 17L17 7M8 7h9v9"/>',
        users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
        desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
        tablet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/>',
        mobile: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
        close: '<path d="M6 6l12 12M18 6L6 18"/>'
    };
    const glyph = (name, cls = '') => `<svg class="wss-glyph ${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name] || GLYPHS.link}</svg>`;
    const hash = text => Array.from(String(text || '')).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const hue = text => hash(text) % 360;
    const spriteHas = name => !!name && !!document.getElementById('icon-' + name);
    function iconHtml(name, label, cls = '') {
        if (name && frappe.utils.icon && spriteHas(name)) return `<span class="wss-ico ${cls}">${frappe.utils.icon(name, 'md')}</span>`;
        const letter = esc((String(label || name || '?').trim().charAt(0) || '?').toUpperCase());
        return `<span class="wss-ico wss-ico-letter ${cls}">${letter}</span>`;
    }
    function siteIcons() {
        const ids = Array.from(document.querySelectorAll('symbol[id^="icon-"]')).map(s => s.id.slice(5));
        return ids.length ? Array.from(new Set(ids)).sort() : FALLBACK_ICONS;
    }

    root.html(`<div class="wss-app">
        <header class="wss-topbar">
            <div class="wss-identity">
                <span class="wss-brand-mark" id="wss-brand-icon"></span>
                <div class="wss-identity-text">
                    <input id="wss-title" class="wss-title-input" placeholder="${esc(__('Untitled workspace'))}" aria-label="Workspace title" autocomplete="off">
                    <div class="wss-meta-line"><span class="wss-kicker">thinkNXG Workspace Studio</span><span id="wss-status" class="wss-pill" role="status">${esc(__('New design'))}</span><span id="wss-audience-pill" class="wss-pill wss-pill-soft"></span></div>
                </div>
            </div>
            <div class="wss-toolbar">
                <div class="wss-btn-group">
                    <button type="button" class="btn btn-default btn-sm wss-icon-btn" id="wss-undo" title="Undo (Ctrl+Z)" aria-label="Undo">${glyph('undo')}</button>
                    <button type="button" class="btn btn-default btn-sm wss-icon-btn" id="wss-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${glyph('redo')}</button>
                </div>
                <button type="button" class="btn btn-default btn-sm" id="wss-history">${glyph('clock')}<span>History / Rollback</span></button>
                <button type="button" class="btn btn-default btn-sm" id="wss-validate">${glyph('check')}<span>Validate</span><b class="wss-count" id="wss-issue-count"></b></button>
                <button type="button" class="btn btn-default btn-sm" id="wss-preview">Preview</button>
                <button type="button" class="btn btn-default btn-sm" id="wss-publish" disabled>Publish</button>
                <button type="button" class="btn btn-primary btn-sm" id="wss-save" disabled>Save</button>
            </div>
        </header>
        <div class="wss-fields">
            <label>Studio design<select id="wss-existing" class="form-control input-sm"></select></label>
            <label>Module (required)<select id="wss-module" class="form-control input-sm" required aria-required="true"></select></label>
            <label>Native workspace<select id="wss-target" class="form-control input-sm"></select></label>
        </div>
        <div id="wss-errors" role="alert"></div>
        <div class="wss-surface-bar">
            <nav class="wss-tabs" aria-label="Design surface">${Object.entries(SURFACES).map(([key, s]) => `<button type="button" class="wss-tab" data-surface="${key}">${glyph(s.glyph)}<span>${s.label}</span><b class="wss-tab-count"></b></button>`).join('')}</nav>
            <div class="wss-devices" aria-label="Preview width">${['desktop', 'tablet', 'mobile'].map(d => `<button type="button" class="wss-device" data-device="${d}" title="${d}">${glyph(d)}</button>`).join('')}</div>
        </div>
        <div class="wss-layout">
            <aside class="wss-panel wss-edit wss-library">
                <div class="wss-panel-head"><h4>Components</h4><span>Drag onto the canvas, or click to add.</span></div>
                <label class="wss-search">${glyph('search')}<input id="wss-palette-search" type="search" placeholder="Filter" aria-label="Filter components"></label>
                <div id="wss-palette"></div>
            </aside>
            <main class="wss-panel wss-stage-panel">
                <div class="wss-stage-head"><div><h4 id="wss-canvas-title"></h4><p id="wss-help"></p></div></div>
                <div class="wss-stage" id="wss-stage"></div>
            </main>
            <aside class="wss-panel wss-edit wss-inspector">
                <div class="wss-panel-head"><h4>Properties</h4><span id="wss-inspector-sub"></span></div>
                <div id="wss-properties"></div>
            </aside>
        </div>
    </div>`);

    /* ---------- state helpers ---------- */
    const list = (create = false) => M.rows(state, surface, create);
    const sectionKey = () => surface === 'sidebar' ? [state.navigation, 'items'] : surface === 'dock' ? [state.dock, 'entries'] : surface === 'desktop' ? [state.dock, 'desktop_icons'] : [state.layout, 'components'];
    const active = () => { const [object, key] = sectionKey(); return surface === 'workspace' || key in object; };
    const serialize = () => JSON.stringify({state, scope, assignments, wsIcon});
    function restore(snapshot) {
        const data = JSON.parse(snapshot);
        state = data.state; scope = data.scope; assignments = data.assignments; wsIcon = data.wsIcon;
        if (selected != null && selected >= list().length) selected = null;
    }
    function changed() { dirty = true; setStatus(__('Unsaved changes'), 'warn'); }
    function setStatus(text, tone = '') { root.find('#wss-status').text(text).attr('data-tone', tone); }
    // Record an undo point, apply a structural change, then redraw everything.
    function mutate(fn, redraw = render) { if (preview) return; hist.record(serialize()); fn(); changed(); redraw(); }
    // Record an undo point for a property edit without rebuilding the inspector (keeps focus).
    function edit(fn) { hist.record(serialize()); fn(); changed(); drawCanvas(); updateChrome(); }

    function issues(strict = false) {
        const result = M.validate(state);
        if (!String(root.find('#wss-title').val() || '').trim()) result.unshift('Workspace title required');
        const module = root.find('#wss-module').val();
        if (!module) result.push('Select a Module before saving or publishing.');
        else if (!boot.modules.includes(module)) result.push('The saved Module is unavailable. Choose an existing Module.');
        result.push(...M.validateAssignments(scope, assignments, strict));
        return result;
    }
    function errors(strict = false) {
        const result = issues(strict);
        const module = root.find('#wss-module').val();
        root.find('#wss-module').attr('aria-invalid', !module || !boot.modules.includes(module) ? 'true' : 'false');
        const box = root.find('#wss-errors').empty();
        if (result.length) {
            const ul = $('<ul></ul>').appendTo(box.append($('<strong></strong>').text(__('Fix before saving or publishing'))));
            result.forEach(message => {
                const li = $('<li></li>').text(message).appendTo(ul);
                const m = /^(workspace|sidebar|dock|desktop) item (\d+)/.exec(message);
                if (m) $('<button type="button" class="btn btn-xs btn-link">Show</button>').on('click', () => { surface = m[1]; selected = Number(m[2]) - 1; preview = false; render(); }).appendTo(li);
            });
        }
        return result;
    }
    // Item-level problems drawn directly on canvas blocks.
    function itemIssues() {
        const map = {};
        M.validate(state).forEach(message => {
            const m = /^(workspace|sidebar|dock|desktop) item (\d+): (.*)$/.exec(message);
            if (m && m[1] === surface) (map[Number(m[2]) - 1] ||= []).push(m[3]);
        });
        return map;
    }

    /* ---------- Frappe controls ---------- */
    function control(parent, df, value, onChange) {
        let initializing = true;
        const ctl = frappe.ui.form.make_control({parent, df: {...df, change: () => { if (!initializing) onChange(ctl.get_value()); }}, render_input: true});
        Promise.resolve(ctl.set_value(value ?? '')).then(() => { initializing = false; }, () => { initializing = false; });
        return ctl;
    }
    function section(host, title, note) {
        const box = $('<section class="wss-section"></section>').appendTo(host);
        $('<h5></h5>').text(title).appendTo(box);
        if (note) $('<p class="wss-note"></p>').text(note).appendTo(box);
        return box;
    }
    function segmented(parent, label, options, value, onPick, attr) {
        const wrap = $('<div class="wss-field"></div>').appendTo(parent);
        if (label) $('<span class="wss-field-label"></span>').text(label).appendTo(wrap);
        const seg = $('<div class="wss-seg" role="radiogroup"></div>').attr('aria-label', label || '').appendTo(wrap);
        options.forEach(([v, text, title]) => $('<button type="button" role="radio"></button>').attr({[attr]: v, title: title || text, 'aria-checked': String(v) === String(value)}).toggleClass('on', String(v) === String(value)).html(text).on('click', () => onPick(v)).appendTo(seg));
        return wrap;
    }
    function toggle(parent, label, checked, onChange, attr = '') {
        const el = $(`<label class="wss-switch"><input type="checkbox" ${attr}><span class="wss-switch-track"></span><span class="wss-switch-label"></span></label>`).appendTo(parent);
        el.find('.wss-switch-label').text(label);
        el.find('input').prop('checked', !!checked).on('change', function () { onChange(this.checked); });
        return el;
    }
    function iconPicker(parent, label, value, fallbackLabel, onPick) {
        const wrap = $('<div class="wss-field wss-icon-field"></div>').appendTo(parent);
        $('<span class="wss-field-label"></span>').text(label).appendTo(wrap);
        const btn = $('<button type="button" class="wss-icon-current"></button>').html(iconHtml(value, fallbackLabel) + `<span>${esc(value || __('Choose icon'))}</span>`).appendTo(wrap);
        const pop = $('<div class="wss-icon-pop" hidden></div>').appendTo(wrap);
        const search = $('<input type="search" class="form-control input-xs" placeholder="Search or type an icon name">').appendTo(pop);
        const grid = $('<div class="wss-icon-grid-pick"></div>').appendTo(pop);
        const all = siteIcons();
        function fill() {
            const q = String(search.val() || '').trim().toLowerCase();
            grid.empty();
            const names = all.filter(n => !q || n.includes(q)).slice(0, 120);
            if (q && !names.includes(q)) names.unshift(q);
            names.forEach(n => $('<button type="button" class="wss-icon-option"></button>').attr({'data-icon': n, title: n}).toggleClass('on', n === value).html(iconHtml(n, n) + `<small>${esc(n)}</small>`).on('click', () => { pop.attr('hidden', true); onPick(n); }).appendTo(grid));
            if (value) $('<button type="button" class="wss-icon-option wss-icon-clear">Clear</button>').on('click', () => { pop.attr('hidden', true); onPick(''); }).appendTo(grid);
        }
        btn.on('click', () => { const open = pop.attr('hidden') != null; pop.attr('hidden', open ? null : true); if (open) { fill(); search.trigger('focus'); } });
        search.on('input', fill);
        return wrap;
    }

    /* ---------- palette ---------- */
    function linkTypes() {
        const supported = boot.capabilities?.link_types?.[surface] || [];
        return supported.length ? supported : ['DocType', 'Report', 'Page', 'Workspace', 'Dashboard', 'URL'];
    }
    function renderPalette() {
        const host = root.find('#wss-palette').empty(), q = String(root.find('#wss-palette-search').val() || '').trim().toLowerCase();
        const match = text => !q || String(text).toLowerCase().includes(q);
        const tile = (attrs, glyphName, title, hint) => $('<button type="button" class="wss-palette-item" draggable="true"></button>').attr(attrs)
            .html(`<span class="wss-tile-glyph">${glyph(glyphName)}</span><span class="wss-tile-text"><b>${esc(title)}</b><small>${esc(hint)}</small></span>`);
        if (surface === 'workspace') {
            ['Layout', 'Navigation', 'Data'].forEach(group => {
                const items = Object.entries(COMPONENTS).filter(([type, c]) => c.group === group && match(c.label + ' ' + c.hint));
                if (!items.length) return;
                const box = $('<div class="wss-palette-group"></div>').append($('<h6></h6>').text(group)).appendTo(host);
                items.forEach(([type, c]) => box.append(tile({'data-type': type}, c.glyph, c.label, c.hint)));
            });
        } else {
            const noun = {sidebar: 'Sidebar item', dock: 'Dock item', desktop: 'Desktop Icon'}[surface];
            const box = $('<div class="wss-palette-group"></div>').append($('<h6></h6>').text('Links')).appendTo(host);
            if (match(noun)) box.append(tile({'data-type': 'link'}, 'link', SURFACES[surface].label + ' item', 'Blank ' + noun.toLowerCase()));
            linkTypes().filter(t => match(t)).forEach(t => box.append(tile({'data-type': 'link-preset', 'data-link-type': t}, LINK_GLYPH[t] || 'link', t, noun + ' to a ' + t)));
            const canWorkspace = linkTypes().some(t => ['Workspace', 'Workspace Sidebar'].includes(t));
            const spaces = (boot.native_workspaces || []).filter(w => match((w.title || w.name) + ' ' + (w.module || '')));
            if (canWorkspace && spaces.length) {
                const lib = $('<div class="wss-palette-group"></div>').append($('<h6></h6>').text('Workspaces on this site')).appendTo(host);
                spaces.slice(0, 60).forEach(w => lib.append(tile({'data-type': 'workspace-ref', 'data-name': w.name}, 'grid', w.title || w.name, w.module || 'Workspace')));
            }
        }
        if (!host.children().length) host.append($('<p class="wss-note"></p>').text(__('No components match.')));
    }

    /* ---------- creating items ---------- */
    function blank(kind, extra = {}) {
        if (surface === 'workspace') {
            const c = COMPONENTS[kind];
            return {id: frappe.utils.get_random(10), type: kind, title: kind === 'spacer' ? '' : c.label, description: kind === 'text' ? '' : '',
                config: {col: ['heading', 'text', 'quick_list'].includes(kind) ? 12 : kind === 'chart' ? 6 : kind === 'spacer' ? 12 : 3, ...(kind === 'heading' ? {level: 4} : {}), ...(kind === 'shortcut' ? {link_type: 'DocType', link_to: ''} : {})}};
        }
        const type = extra.linkType || linkTypes()[0] || 'DocType';
        const base = surface === 'sidebar' ? {label: extra.label || 'New item', type, link_to: extra.link_to || '', indent: 0}
            : surface === 'dock' ? {title: extra.label || 'New item', link_type: type, link_to: extra.link_to || ''}
            : {label: extra.label || 'New icon', link_type: type, link_to: extra.link_to || ''};
        if (extra.icon) base.icon = extra.icon;
        return base;
    }
    function fromPalette(data) {
        if (surface === 'workspace') return M.types.includes(data.type) ? blank(data.type) : null;
        if (data.type === 'link') return blank('link');
        if (data.type === 'link-preset') return blank('link', {linkType: data.linkType});
        if (data.type === 'workspace-ref') {
            const w = (boot.native_workspaces || []).find(x => x.name === data.name) || {name: data.name};
            const types = linkTypes(), type = types.includes('Workspace') ? 'Workspace' : types.includes('Workspace Sidebar') ? 'Workspace Sidebar' : 'Workspace';
            return blank('link', {linkType: type, link_to: w.name, label: w.title || w.name, icon: w.icon});
        }
        return null;
    }
    function insert(row, at = list().length, wantedIndent = null) {
        if (!row) return;
        mutate(() => {
            const rows = list(true);
            if (surface === 'sidebar') selected = M.sidebarDrop(rows, null, at, wantedIndent ?? (at ? Number(rows[at - 1]?.indent || 0) : 0), row);
            else { rows.splice(at, 0, row); selected = at; }
        });
    }
    function moveTo(from, to, wantedIndent = null) {
        mutate(() => {
            const rows = list();
            if (surface === 'sidebar') selected = wantedIndent == null ? M.move(rows, from, to, true) : M.sidebarDrop(rows, from, to, wantedIndent);
            else selected = M.move(rows, from, to, false);
        });
    }
    function removeAt(index) {
        const rows = list(), end = surface === 'sidebar' ? M.subtreeEnd(rows, index) : index + 1;
        if (end - index > 1 && !window.confirm('Delete this item and its nested items?')) return;
        mutate(() => { rows.splice(index, end - index); selected = null; });
    }
    function duplicateAt(index) { mutate(() => { selected = M.duplicate(list(), index, surface === 'sidebar'); }); }

    /* ---------- canvas ---------- */
    function describe(row) {
        const cfg = surface === 'workspace' ? row.config || {} : row;
        const typeKey = surface === 'sidebar' ? 'type' : 'link_type';
        return {cfg, title: row.title || row.label || '', linkType: cfg[typeKey] || 'DocType', target: cfg.link_to || cfg.chart_name || cfg.number_card_name || cfg.quick_list_name || cfg.sidebar || ''};
    }
    function colorOf(name) { const key = String(name || '').toLowerCase(); return COLOR_HEX[key] || null; }
    function chartSvg(seed) {
        const h = hash(seed || 'chart'), bars = Array.from({length: 9}, (_, i) => 18 + ((h >> (i * 3)) & 15) * 3 + (i % 3) * 4);
        return `<svg class="wss-chart-svg" viewBox="0 0 180 80" preserveAspectRatio="none" aria-hidden="true">${bars.map((b, i) => `<rect x="${i * 20 + 2}" y="${80 - b}" width="13" height="${b}" rx="2"/>`).join('')}</svg>`;
    }
    function workspaceBlock(row, i, problems) {
        const {cfg, title, linkType, target} = describe(row), kind = row.type;
        const col = Math.max(1, Math.min(12, Number(cfg.col) || 4));
        const el = $('<div class="wss-block wss-w-block" tabindex="0" role="button"></div>').attr({'data-index': i, 'data-kind': kind}).css('grid-column', 'span ' + col);
        const titleText = title || (kind === 'spacer' ? '' : COMPONENTS[kind]?.label || kind || 'Untitled');
        const strong = () => $('<strong class="wss-title-text"></strong>').text(titleText);
        if (kind === 'heading') el.append($('<div class="wss-heading"></div>').attr('data-level', cfg.level || 4).append(strong()));
        else if (kind === 'text') el.append(strong().addClass('wss-sr'), $('<p class="wss-text"></p>').text(row.description || cfg.body || __('Double-click the title, or edit text in Properties.')));
        else if (kind === 'spacer') el.append($('<div class="wss-spacer"></div>').append(strong().addClass('wss-sr').text('Spacer'), $('<span></span>').text(__('Spacer'))));
        else if (kind === 'shortcut') {
            const tint = colorOf(cfg.color);
            el.append($('<div class="wss-shortcut"></div>').css('--tint', tint || 'var(--wss-accent)').append(
                $(`<span class="wss-sc-chip">${glyph(LINK_GLYPH[linkType] || 'shortcut')}</span>`),
                $('<div class="wss-sc-body"></div>').append(strong(), $('<span class="wss-dest"></span>').text(target ? linkType + ' · ' + target + (cfg.doc_view ? ' · ' + cfg.doc_view : '') : __('No destination yet'))),
                $(`<span class="wss-sc-arrow">${glyph('arrow')}</span>`)));
        } else if (kind === 'chart') {
            el.append($('<div class="wss-card-head"></div>').append(strong(), $('<span class="wss-dest"></span>').text(cfg.chart_name || __('Choose a chart'))), $(chartSvg(cfg.chart_name || row.id)));
        } else if (kind === 'number_card') {
            el.append($('<div class="wss-number-card"></div>').append(strong().addClass('wss-number-label'), $('<div class="wss-number">—</div>'), $('<span class="wss-dest"></span>').text(cfg.number_card_name || __('Choose a number card'))));
        } else if (kind === 'quick_list') {
            el.append($('<div class="wss-card-head"></div>').append(strong(), $('<span class="wss-dest"></span>').text(cfg.quick_list_name || __('Choose a DocType'))),
                $('<div class="wss-ql"></div>').append(...[0, 1, 2].map(n => $('<div class="wss-ql-row"><i></i><i></i><i></i></div>'))));
        } else el.append($('<div class="wss-unknown"></div>').append(strong(), $('<span class="wss-dest"></span>').text(__('Unsupported component preserved'))));
        if (!preview) {
            el.append(`<span class="wss-col-badge">${col}/12</span>`);
            el.append(`<span class="wss-resize" title="Drag to resize" aria-hidden="true"></span>`);
        }
        return el;
    }
    function sidebarBlock(row, i, hasKids) {
        const {title, linkType, target} = describe(row), depth = Number(row.indent || 0);
        const el = $('<div class="wss-block wss-s-block" tabindex="0" role="button"></div>').attr({'data-index': i, 'data-depth': depth}).css('--depth', depth);
        el.append($(`<span class="wss-twisty">${hasKids ? glyph('chevron') : ''}</span>`).toggleClass('open', hasKids && !collapsed.has(row)).toggleClass('has-kids', hasKids));
        el.append($(iconHtml(row.icon, title)), $('<strong class="wss-title-text"></strong>').text(title || 'Untitled'));
        el.append($('<span class="wss-s-meta"></span>').text(target ? linkType : __('No destination')));
        if (row.hidden) el.addClass('is-hidden').append(`<span class="wss-hidden-flag" title="Hidden">${glyph('eyeoff')}</span>`);
        return el;
    }
    function tileBlock(row, i, kind) {
        const {title} = describe(row), h = hue(title || row.link_to || i);
        const el = $('<div class="wss-block wss-t-block" tabindex="0" role="button"></div>').attr({'data-index': i}).addClass(kind === 'dock' ? 'wss-dock-tile' : 'wss-app-tile');
        el.append($('<span class="wss-app-icon"></span>').css('--h', h).html(iconHtml(row.icon, title, 'wss-on-tint')), $('<strong class="wss-title-text"></strong>').text(title || 'Untitled'));
        if (kind === 'dock' && row.sidebar) el.append($('<span class="wss-dest"></span>').text(row.sidebar));
        if (row.hidden) el.addClass('is-hidden').append(`<span class="wss-hidden-flag" title="Hidden">${glyph('eyeoff')}</span>`);
        return el;
    }
    function drawCanvas() {
        const stage = root.find('#wss-stage').empty().attr({'data-stage': surface, 'data-device': preview ? device : 'desktop'}).toggleClass('is-preview', preview);
        const title = String(root.find('#wss-title').val() || '').trim() || __('Untitled workspace');
        const frame = $('<div class="wss-desk"></div>').appendTo(stage);
        const canvas = $('<div id="wss-canvas" class="wss-canvas"></div>');
        if (surface === 'workspace') {
            frame.append($('<div class="wss-desk-head"></div>').append($(iconHtml(wsIcon, title)), $('<span></span>').text(title)), canvas.addClass('wss-grid'));
        } else if (surface === 'sidebar') {
            const side = $('<div class="wss-desk-side"></div>').append($('<div class="wss-side-title"></div>').text(state.navigation.title || title), canvas.addClass('wss-tree'));
            frame.addClass('wss-desk-split').append(side, '<div class="wss-ghost-content"><i></i><i></i><i></i><i></i></div>');
        } else if (surface === 'dock') {
            frame.addClass('wss-desk-dock').append('<div class="wss-ghost-content"><i></i><i></i><i></i></div>', $('<div class="wss-dock-wrap"></div>').append(canvas.addClass('wss-dock-bar')));
        } else {
            frame.addClass('wss-desk-home').append(canvas.addClass('wss-icon-grid'));
        }
        const rows = list(), problems = itemIssues();
        let hideBelow = null;
        rows.forEach((row, i) => {
            if (surface === 'sidebar') {
                const depth = Number(row.indent || 0);
                if (hideBelow != null && depth > hideBelow) return;
                hideBelow = null;
                const end = M.subtreeEnd(rows, i), kids = end > i + 1;
                if (kids && collapsed.has(row)) hideBelow = depth;
                if (preview && row.hidden) return;
                canvas.append(sidebarBlock(row, i, kids).attr('data-end', end));
                return;
            }
            if (preview && row.hidden) return;
            canvas.append(surface === 'workspace' ? workspaceBlock(row, i, problems) : tileBlock(row, i, surface));
        });
        canvas.find('.wss-block').each(function () {
            const i = Number(this.getAttribute('data-index')), $b = $(this);
            $b.attr({draggable: !preview, 'aria-label': 'Select ' + ($b.find('.wss-title-text').first().text() || 'item')}).toggleClass('selected', i === selected && !preview);
            if (problems[i] && !preview) $b.addClass('has-issue').attr('title', problems[i].join('\n')).append(`<span class="wss-issue-dot" aria-label="${esc(problems[i].join('; '))}">!</span>`);
            if (!preview) $b.append(`<span class="wss-block-tools"><button type="button" class="wss-tool" data-act="duplicate" title="Duplicate (Ctrl+D)" aria-label="Duplicate">${glyph('copy')}</button><button type="button" class="wss-tool" data-act="delete" title="Delete" aria-label="Delete">${glyph('trash')}</button></span>`);
        });
        if (!active() && !preview) {
            canvas.append($('<div class="wss-inactive"></div>').append($('<b></b>').text(__('Not managed by this design')), $('<span></span>').text(__('Drop an item here, or turn on “Publish this surface” in Properties, to take over this surface. Until then native data is left untouched.'))));
        } else if (!rows.length) {
            canvas.append($('<p class="wss-empty"></p>').text(preview ? __('No items on this surface.') : __('Drag a component here to begin.')));
        }
        if (!preview && surface === 'workspace') canvas.append($('<div class="wss-drop-end"></div>').html(glyph('plus') + `<span>${esc(__('Drop here to append'))}</span>`));
        canvas.append('<div class="wss-drop-indicator" hidden><span></span></div>');
    }
    function updateChrome() {
        Object.keys(SURFACES).forEach(key => {
            const [object, k] = key === 'workspace' ? [state.layout, 'components'] : key === 'sidebar' ? [state.navigation, 'items'] : [state.dock, key === 'dock' ? 'entries' : 'desktop_icons'];
            const tab = root.find(`[data-surface="${key}"]`);
            tab.find('.wss-tab-count').text(k in object ? (object[k] || []).length : '–');
            tab.toggleClass('is-off', !(key === 'workspace' || k in object));
        });
        root.find('#wss-undo').prop('disabled', busy || preview || !hist.canUndo);
        root.find('#wss-redo').prop('disabled', busy || preview || !hist.canRedo);
        const count = issues(false).length;
        root.find('#wss-issue-count').text(count || '').toggle(!!count);
        const title = String(root.find('#wss-title').val() || '').trim();
        root.find('#wss-brand-icon').html(iconHtml(wsIcon, title || 'W'));
        const audience = scope === 'Global' ? __('Everyone') : `${scope} · ${assignments.filter(a => a.target_type === scope && Number(a.enabled ?? 1)).length}`;
        root.find('#wss-audience-pill').html(glyph('users') + `<span>${esc(audience)}</span>`);
    }

    /* ---------- inspector ---------- */
    function renderProperties() {
        const host = root.find('#wss-properties').empty(), row = list()[selected];
        root.find('#wss-inspector-sub').text(row ? (surface === 'workspace' ? (COMPONENTS[row.type]?.label || row.type) : SURFACES[surface].label + ' item') : __('Design & surface settings'));
        if (!row) return renderSettings(host);
        const workspace = surface === 'workspace', cfg = workspace ? (row.config ||= {}) : row;
        const field = (parent, obj, key, label, type = 'Data', options = null, after = null) => control(parent, {fieldtype: type, fieldname: key, label, ...(options ? {options} : {})}, obj[key], v => edit(() => { obj[key] = type === 'Int' ? Number(v) : v; after && after(v); }));

        const content = section(host, __('Content'));
        if (!(workspace && row.type === 'spacer')) field(content, row, workspace || surface === 'dock' ? 'title' : 'label', 'Title');
        if (workspace && row.type === 'heading') segmented(content, __('Heading level'), [1, 2, 3, 4, 5, 6].map(n => [n, 'H' + n]), cfg.level || 4, v => mutate(() => { cfg.level = Number(v); }), 'data-level');
        if (workspace && row.type === 'text') field(content, row, 'description', 'Text', 'Small Text');
        if (workspace && !M.types.includes(row.type)) content.append($('<p class="wss-note wss-warn"></p>').text(__('Unsupported component preserved. Remove it or use a supported component before publishing.')));

        const selector = workspace && {chart: ['chart_name', 'Dashboard Chart'], number_card: ['number_card_name', 'Number Card'], quick_list: ['quick_list_name', 'DocType']}[row.type];
        if (selector) field(section(host, __('Data source')), cfg, selector[0], selector[1], 'Link', selector[1]);
        if (!workspace || row.type === 'shortcut') {
            const dest = section(host, __('Destination'));
            const typeKey = surface === 'sidebar' ? 'type' : 'link_type';
            const type = cfg[typeKey] || linkTypes()[0] || 'DocType';
            const options = Array.from(new Set([...linkTypes(), type])).join('\n');
            control(dest, {fieldtype: 'Select', label: 'Link type', options}, type, v => mutate(() => { cfg[typeKey] = v; cfg.link_to = ''; }));
            const external = ['URL', 'External'].includes(type);
            const destinationType = ['Workspace Sidebar'].includes(type) ? 'Workspace' : type;
            field(dest, cfg, 'link_to', 'Destination', external ? 'Data' : 'Link', external ? null : destinationType);
            if (external) dest.append($('<p class="wss-note"></p>').text(__('Use an https:// address or an /app/ route.')));
            const views = boot.capabilities?.shortcut_views || [];
            if (workspace && type === 'DocType' && views.length) control(dest, {fieldtype: 'Select', label: 'Open as', options: ['', ...views].join('\n')}, cfg.doc_view || '', v => edit(() => { if (v) cfg.doc_view = v; else delete cfg.doc_view; }));
            if (surface === 'dock') field(dest, row, 'sidebar', 'Sidebar / module');
        }

        const look = section(host, workspace ? __('Layout') : __('Appearance'));
        if (workspace) {
            const col = Math.max(1, Math.min(12, Number(cfg.col) || 4));
            const wrap = $('<div class="wss-field"></div>').appendTo(look).append($('<span class="wss-field-label"></span>').text(__('Width') + ` · ${col} of 12 columns`));
            const bar = $('<div class="wss-col-bar" role="radiogroup" aria-label="Width (1–12 columns)"></div>').appendTo(wrap);
            for (let n = 1; n <= 12; n++) $('<button type="button" class="wss-col-cell" role="radio"></button>').attr({'data-col': n, title: n + ' / 12', 'aria-checked': n === col}).toggleClass('on', n <= col).on('click', () => mutate(() => { cfg.col = n; })).appendTo(bar);
            segmented(look, '', [[3, '¼'], [4, '⅓'], [6, '½'], [8, '⅔'], [9, '¾'], [12, 'Full']], col, v => mutate(() => { cfg.col = Number(v); }), 'data-preset');
            const colors = boot.capabilities?.shortcut_colors || [];
            if (row.type === 'shortcut' && colors.length) {
                const cw = $('<div class="wss-field"></div>').appendTo(look).append($('<span class="wss-field-label"></span>').text(__('Colour')));
                const sw = $('<div class="wss-swatches"></div>').appendTo(cw);
                $('<button type="button" class="wss-swatch wss-swatch-none" title="Default"></button>').toggleClass('on', !cfg.color).on('click', () => mutate(() => { delete cfg.color; })).appendTo(sw);
                colors.forEach(c => $('<button type="button" class="wss-swatch"></button>').attr({'data-color': c, title: c}).css('background', colorOf(c) || 'var(--gray-500,#888)').toggleClass('on', cfg.color === c).on('click', () => mutate(() => { cfg.color = c; })).appendTo(sw));
            }
        } else {
            iconPicker(look, __('Icon'), row.icon, describe(row).title, v => mutate(() => { if (v) row.icon = v; else delete row.icon; }));
        }
        if (surface === 'sidebar' || surface === 'desktop') {
            const vis = section(host, __('Visibility'));
            toggle(vis, __('Hidden'), row.hidden, v => mutate(() => { if (v) row.hidden = 1; else delete row.hidden; }), 'data-prop="hidden"');
            vis.append($('<p class="wss-note"></p>').text(__('Hiding a menu entry does not restrict document access; Frappe permissions still apply.')));
        }

        const order = section(host, __('Arrange'));
        const actions = $('<div class="wss-actions"></div>').appendTo(order);
        const button = (label, fn, attrs = {}) => $('<button type="button" class="btn btn-default btn-xs"></button>').attr(attrs).text(label).on('click', fn).appendTo(actions);
        button('Move up', () => moveTo(selected, Math.max(0, previousStart(selected))));
        button('Move down', () => { const rows = list(), end = surface === 'sidebar' ? M.subtreeEnd(rows, selected) : selected + 1; if (end >= rows.length) return; const to = surface === 'sidebar' ? M.subtreeEnd(rows, end) : end + 1; moveTo(selected, to); });
        if (surface === 'sidebar' && nestingSupported()) {
            button('Indent', () => mutate(() => M.indent(list(), selected, 1)));
            button('Outdent', () => mutate(() => M.indent(list(), selected, -1)));
        }
        button('Duplicate', () => duplicateAt(selected));
        button('Delete', () => removeAt(selected), {class: 'btn btn-default btn-xs wss-danger'});
    }
    function previousStart(index) {
        if (surface !== 'sidebar') return index - 1;
        const rows = list(), depth = Number(rows[index]?.indent || 0);
        let i = index - 1;
        while (i > 0 && Number(rows[i].indent || 0) > depth) i--;
        return i;
    }
    function renderSettings(host) {
        host.append($('<p class="wss-note wss-hint"></p>').text(__('Select an item on the canvas to edit it. These settings apply to the whole design.')));
        if (surface !== 'workspace') {
            const surf = section(host, SURFACES[surface].label);
            const [object, key] = sectionKey();
            toggle(surf, __('Publish this surface'), key in object, v => {
                if (v) mutate(() => { object[key] = object[key] || []; });
                else if (!(object[key] || []).length || window.confirm('Remove these items from this saved design? Native Desktop Icons already published will remain.')) mutate(() => { delete object[key]; selected = null; });
                else renderProperties();
            }, 'data-prop="publish-surface"');
            surf.append($('<p class="wss-note"></p>').text(key in object ? __('Publishing replaces this surface with the items on the canvas.') : __('Off: native data for this surface is left untouched when you publish.')));
            if (surface === 'sidebar') control(surf, {fieldtype: 'Data', label: 'Sidebar title'}, state.navigation.title, v => edit(() => { state.navigation.title = v; }));
            if (surface === 'dock') control(surf, {fieldtype: 'Data', label: 'Application'}, state.dock.app || 'erpnext', v => edit(() => { state.dock.app = v; }));
            if (surface === 'desktop') surf.append($('<p class="wss-note"></p>').text(__('Desktop Icons need Desktop Settings → Desktop Icons. Removing an icon here does not delete one that is already published.')));
        }
        const look = section(host, __('Workspace identity'));
        iconPicker(look, __('Workspace icon'), wsIcon, root.find('#wss-title').val(), v => mutate(() => { wsIcon = v; }));

        const caps = boot.capabilities?.assignment_targets;
        const scopes = ['Global', ...(caps && caps.length ? caps : M.ASSIGNMENT_TYPES)];
        if (!scopes.includes(scope)) scopes.push(scope);
        const aud = section(host, __('Audience & visibility'));
        segmented(aud, __('Who is this design for?'), scopes.map(s => [s, s === 'Global' ? 'Everyone' : s]), scope, v => mutate(() => { scope = v; }), 'data-scope');
        const notes = {
            Global: __('Visible to everyone who can see the native Workspace. Existing native role restrictions are left unchanged.'),
            Role: boot.capabilities?.workspace_roles === false ? __('This site’s Workspace has no Roles table, so role visibility cannot be published.') : __('Publishing writes these roles to the native Workspace Roles table. Frappe then shows the workspace only to these roles.'),
            User: __('Stored for personalised runtime. Not yet enforced by Desk — publish a Role-scoped design to restrict visibility today.'),
            Department: __('Stored for personalised runtime. Not yet enforced by Desk.'),
            Company: __('Stored for personalised runtime. Not yet enforced by Desk.')
        };
        aud.append($('<p class="wss-note"></p>').text(notes[scope] || ''));
        if (scope !== 'Global') {
            const chips = $('<div class="wss-chips"></div>').appendTo(aud);
            assignments.forEach((a, i) => {
                const chip = $('<span class="wss-chip"></span>').toggleClass('is-off', !Number(a.enabled ?? 1)).toggleClass('is-other', a.target_type !== scope).attr('data-target', a.target_name)
                    .append($('<small></small>').text(a.target_type), $('<b></b>').text(a.target_name));
                $('<button type="button" class="wss-chip-btn"></button>').attr({title: Number(a.enabled ?? 1) ? 'Disable' : 'Enable', 'aria-label': 'Toggle ' + a.target_name}).html(glyph(Number(a.enabled ?? 1) ? 'eye' : 'eyeoff')).on('click', () => mutate(() => { a.enabled = Number(a.enabled ?? 1) ? 0 : 1; })).appendTo(chip);
                $('<button type="button" class="wss-chip-btn"></button>').attr({title: 'Remove', 'aria-label': 'Remove ' + a.target_name}).html(glyph('close')).on('click', () => mutate(() => { assignments.splice(i, 1); })).appendTo(chip);
                chips.append(chip);
            });
            if (!assignments.length) chips.append($('<span class="wss-note"></span>').text(__('No one added yet.')));
            const adder = control(aud, {fieldtype: 'Link', label: 'Add ' + scope, options: scope}, '', v => {
                const name = String(v || '').trim();
                if (!name) return;
                if (!assignments.some(a => a.target_type === scope && a.target_name === name)) mutate(() => { assignments.push({target_type: scope, target_name: name, enabled: 1, priority: 100}); });
                else adder.set_value('');
            });
        }
    }
    function nestingSupported() { return !!boot?.capabilities?.sidebar_indent; }

    /* ---------- render ---------- */
    function render() {
        root.find('.wss-tab').removeClass('on').attr('aria-pressed', 'false').filter(`[data-surface="${surface}"]`).addClass('on').attr('aria-pressed', 'true');
        root.find('.wss-edit').toggle(!preview);
        root.find('.wss-layout').toggleClass('wss-preview', preview);
        root.find('.wss-devices').toggle(preview);
        root.find('.wss-device').removeClass('on').filter(`[data-device="${device}"]`).addClass('on');
        root.find('#wss-preview').text(preview ? 'Exit preview' : 'Preview').toggleClass('btn-primary-light', preview);
        root.find('#wss-canvas-title').text(SURFACES[surface].label + (preview ? ' preview' : ''));
        root.find('#wss-help').text(preview ? __('How this surface will look. Charts and numbers are placeholders; native rendering depends on your installed Frappe schema.') : surface === 'sidebar' && !nestingSupported() ? __('Drag to reorder. Numeric nesting is unavailable in this installed Sidebar schema.') : SURFACES[surface].help);
        renderPalette(); drawCanvas(); renderProperties(); updateChrome();
    }

    /* ---------- drag & drop ---------- */
    const INDENT_PX = 18;
    const dropMode = () => surface === 'sidebar' ? 'vertical' : surface === 'dock' ? 'horizontal' : 'grid';
    function dropTarget(e) {
        const canvas = root.find('#wss-canvas')[0];
        const blocks = Array.from(canvas.querySelectorAll('.wss-block'));
        const rects = blocks.map(b => b.getBoundingClientRect());
        const point = {x: e.clientX, y: e.clientY};
        let k = M.dropIndex(rects, point, dropMode());
        const rows = list();
        let index;
        if (k < blocks.length) index = Number(blocks[k].getAttribute('data-index'));
        else if (blocks.length) index = surface === 'sidebar' ? Number(blocks[blocks.length - 1].getAttribute('data-end')) : Number(blocks[blocks.length - 1].getAttribute('data-index')) + 1;
        else index = rows.length;
        let indent = null;
        if (surface === 'sidebar') {
            // Horizontal travel from where the drag began (or entered the canvas) sets depth:
            // move right to nest under the row above, left to outdent.
            const depth = row => Number(row?.indent || 0);
            const from = dragging && dragging.index != null ? Number(dragging.index) : null;
            let prev = index - 1;
            if (from != null && prev >= from && prev < M.subtreeEnd(rows, from)) prev = from - 1;
            const max = prev >= 0 ? depth(rows[prev]) + 1 : 0;
            if (dragging && dragging.originX == null) dragging.originX = e.clientX;
            const origin = dragging?.originX ?? e.clientX;
            const base = from != null ? depth(rows[from]) : prev >= 0 ? depth(rows[prev]) : 0;
            const wanted = base + Math.round((e.clientX - origin) / INDENT_PX);
            indent = nestingSupported() ? Math.max(0, Math.min(max, wanted)) : 0;
            // A drop inside the dragged subtree keeps its place and only changes depth.
            if (from != null && index >= from && index <= M.subtreeEnd(rows, from)) {
                const own = blocks.findIndex(b => Number(b.getAttribute('data-index')) === from);
                if (own >= 0) { k = own; index = from; }
            }
        }
        return {k, index, indent, blocks, rects, box: canvas.getBoundingClientRect()};
    }
    function showIndicator(t) {
        const canvas = root.find('#wss-canvas'), ind = canvas.find('.wss-drop-indicator');
        const box = t.box, mode = dropMode();
        let css;
        const ref = t.rects[t.k] || t.rects[t.rects.length - 1];
        if (!ref) css = {left: 12, top: 12, width: box.width - 24, height: 3};
        else if (mode === 'vertical') {
            const y = (t.rects[t.k] ? ref.top - 3 : ref.bottom + 1) - box.top + canvas[0].scrollTop;
            const x = 8 + (t.indent || 0) * INDENT_PX;
            css = {left: x, top: y, width: box.width - x - 12, height: 3};
        } else {
            const x = (t.rects[t.k] ? ref.left - 7 : ref.right + 4) - box.left;
            css = {left: x, top: ref.top - box.top, width: 3, height: ref.height};
        }
        ind.removeAttr('hidden').css(css).toggleClass('is-h', mode === 'vertical' || !ref).find('span').text(surface === 'sidebar' && t.indent ? 'Level ' + (t.indent + 1) : '');
    }
    const hideIndicator = () => root.find('.wss-drop-indicator').attr('hidden', true);
    root.on('dragstart', '.wss-block,.wss-palette-item', function (e) {
        if (preview || this.getAttribute('contenteditable') === 'true') { e.preventDefault(); return; }
        const el = $(this);
        dragging = {surface, type: el.attr('data-type'), linkType: el.attr('data-link-type'), name: el.attr('data-name'), index: el.attr('data-index'), originX: el.is('.wss-block') ? e.originalEvent.clientX : null};
        e.originalEvent.dataTransfer.effectAllowed = dragging.index != null ? 'move' : 'copy';
        e.originalEvent.dataTransfer.setData('application/x-workspace-studio', JSON.stringify(dragging));
        setTimeout(() => el.addClass('is-dragging'), 0);
        root.find('.wss-stage').addClass('is-dropping');
    });
    root.on('dragend', '.wss-block,.wss-palette-item', function () { $(this).removeClass('is-dragging'); dragging = null; hideIndicator(); root.find('.wss-stage').removeClass('is-dropping'); });
    root.on('dragover', '#wss-canvas', function (e) {
        if (preview) return;
        e.preventDefault();
        if (dragging && dragging.surface !== surface) return;
        showIndicator(dropTarget(e.originalEvent));
    });
    root.on('dragleave', '#wss-canvas', function (e) { if (!this.contains(e.originalEvent.relatedTarget)) hideIndicator(); });
    root.on('drop', '#wss-canvas', function (e) {
        e.preventDefault(); hideIndicator(); root.find('.wss-stage').removeClass('is-dropping');
        if (preview) return;
        let data = dragging;
        try { data = data || JSON.parse(e.originalEvent.dataTransfer.getData('application/x-workspace-studio')); } catch { /* no designer payload */ }
        if (!data || data.surface !== surface) { dragging = null; return; }
        const t = dropTarget(e.originalEvent);
        dragging = null;
        if (data.index != null) moveTo(Number(data.index), t.index, surface === 'sidebar' ? t.indent : null);
        else insert(fromPalette(data), t.index, t.indent);
    });

    /* ---------- resize ---------- */
    root.on('pointerdown', '.wss-resize', function (e) {
        if (preview) return;
        e.preventDefault(); e.stopPropagation();
        const block = $(this).closest('.wss-block'), index = Number(block.attr('data-index')), row = list()[index];
        const grid = root.find('#wss-canvas')[0], styles = getComputedStyle(grid);
        const gap = parseFloat(styles.columnGap) || 0, pitch = (grid.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) + gap) / 12;
        const start = e.clientX, width = block[0].getBoundingClientRect().width, before = serialize();
        let col = Number(row.config?.col) || 4;
        block.attr('draggable', false).addClass('is-resizing');
        const moveFn = ev => {
            col = M.columnsFor(width + ev.clientX - start, pitch, gap);
            block.css('grid-column', 'span ' + col).find('.wss-col-badge').text(col + '/12');
        };
        const upFn = () => {
            document.removeEventListener('pointermove', moveFn); document.removeEventListener('pointerup', upFn);
            block.removeClass('is-resizing');
            if (col !== (Number(row.config?.col) || 4)) { hist.record(before); (row.config ||= {}).col = col; changed(); }
            selected = index; render();
        };
        document.addEventListener('pointermove', moveFn); document.addEventListener('pointerup', upFn);
    });

    /* ---------- selection, tools, inline editing ---------- */
    root.on('click', '.wss-palette-item', function () { if (!preview) { const el = $(this); insert(fromPalette({type: el.attr('data-type'), linkType: el.attr('data-link-type'), name: el.attr('data-name')})); } });
    root.on('input', '#wss-palette-search', renderPalette);
    root.on('click', '.wss-tool', function (e) {
        e.stopPropagation();
        const index = Number($(this).closest('.wss-block').attr('data-index'));
        if ($(this).attr('data-act') === 'duplicate') duplicateAt(index); else removeAt(index);
    });
    root.on('click', '.wss-twisty.has-kids', function (e) {
        e.stopPropagation();
        const row = list()[Number($(this).closest('.wss-block').attr('data-index'))];
        if (collapsed.has(row)) collapsed.delete(row); else collapsed.add(row);
        drawCanvas();
    });
    root.on('click keydown', '.wss-block', function (e) {
        if (this.querySelector('[contenteditable="true"]')) return;
        if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
        if (preview) return;
        e.preventDefault();
        const index = Number($(this).attr('data-index'));
        if (index === selected) return;
        // Update selection in place so a following double-click still targets the same node.
        selected = index;
        root.find('#wss-canvas .wss-block').removeClass('selected');
        $(this).addClass('selected').trigger('focus');
        renderProperties(); updateChrome();
    });
    root.on('click', '#wss-stage', function (e) {
        if (preview || $(e.target).closest('.wss-block').length) return;
        if (selected != null) { selected = null; drawCanvas(); renderProperties(); }
    });
    root.on('dblclick', '.wss-block .wss-title-text:not(.wss-sr)', function (e) {
        if (preview) return;
        e.stopPropagation();
        const el = $(this), block = el.closest('.wss-block'), index = Number(block.attr('data-index')), row = list()[index];
        const key = surface === 'workspace' || surface === 'dock' ? 'title' : 'label';
        block.attr('draggable', false);
        el.attr('contenteditable', 'true').addClass('is-editing').trigger('focus');
        document.getSelection().selectAllChildren(this);
        const finish = commit => {
            el.off('.inline').attr('contenteditable', 'false').removeClass('is-editing');
            const value = el.text().trim();
            if (commit && value !== (row[key] || '')) mutate(() => { row[key] = value; selected = index; });
            else render();
        };
        el.on('keydown.inline', ev => { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } if (ev.key === 'Escape') finish(false); ev.stopPropagation(); });
        el.on('blur.inline', () => finish(true));
    });

    /* ---------- toolbar ---------- */
    root.on('click', '.wss-tab[data-surface]', function () { surface = $(this).attr('data-surface'); selected = null; render(); });
    root.on('click', '.wss-device[data-device]', function () { device = $(this).attr('data-device'); render(); });
    function undo() { const prev = hist.undo(serialize()); if (prev) { restore(prev); changed(); render(); } }
    function redo() { const next = hist.redo(serialize()); if (next) { restore(next); changed(); render(); } }
    root.find('#wss-undo').on('click', undo);
    root.find('#wss-redo').on('click', redo);
    root.find('#wss-preview').on('click', () => { preview = !preview; render(); });
    root.find('#wss-validate').on('click', () => { if (!errors(true).length) frappe.show_alert({message: __('Design is valid locally; native schema checks run at publish.'), indicator: 'green'}); });
    root.find('#wss-title').on('input', () => { drawCanvas(); updateChrome(); });
    root.find('#wss-title,#wss-module,#wss-target').on('change', () => { changed(); updateChrome(); });
    $(document).on('keydown.wss', e => {
        if (!root.is(':visible') || busy) return;
        const t = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
        const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
        if (mod && key === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if (mod && key === 'y' && !typing) { e.preventDefault(); redo(); return; }
        if (typing || preview || selected == null || !list()[selected]) return;
        if (mod && key === 'd') { e.preventDefault(); duplicateAt(selected); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && $(t).closest('#wss-canvas').length) { e.preventDefault(); removeAt(selected); }
        else if (e.key === 'Escape') { selected = null; drawCanvas(); renderProperties(); }
        else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveTo(selected, Math.max(0, previousStart(selected))); }
        else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); const rows = list(), end = surface === 'sidebar' ? M.subtreeEnd(rows, selected) : selected + 1; if (end < rows.length) moveTo(selected, surface === 'sidebar' ? M.subtreeEnd(rows, end) : end + 1); }
    });

    function working(action) {
        return async () => {
            if (busy) return;
            busy = true; root.find('button,input,select,textarea').prop('disabled', true);
            try { await action(); }
            catch (e) { frappe.msgprint(esc(e.message || 'Operation failed')); }
            finally { busy = false; root.find('button,input,select,textarea').prop('disabled', false); root.find('#wss-publish').prop('disabled', !boot?.can_publish); updateChrome(); }
        };
    }
    function setModule(value) {
        const el = root.find('#wss-module');
        if (value && !el.find('option').toArray().some(option => option.value === value)) el.append($('<option></option>').val(value).text(value + ' (unavailable)'));
        el.val(value || '');
    }
    async function refresh() {
        boot = await call('bootstrap');
        boot.capabilities ||= {};
        const options = (id, rows, first) => { const el = root.find(id), value = el.val(); el.empty().append($('<option value=""></option>').text(first)); rows.forEach(([key, label]) => el.append($('<option></option>').val(key).text(label))); el.val(value); };
        const module = root.find('#wss-module').val();
        options('#wss-module', boot.modules.map(x => [x, x]), 'Choose module');
        setModule(module);
        const target = root.find('#wss-target').val();
        options('#wss-target', (boot.native_workspaces || []).map(x => [x.name, x.title || x.name]), 'Create new workspace');
        root.find('#wss-target').val(target || '');
        options('#wss-existing', (boot.studio_workspaces || []).map(x => [x.name, x.workspace_title + (x.status && x.status !== 'Draft' ? ' · ' + x.status : '')]), 'New Studio design');
        root.find('#wss-existing').val(current || '');
    }
    async function save(strict = false) {
        if (errors(strict).length) throw Error('Correct the validation errors before saving.');
        const result = await call('save_design', {name: current, title: root.find('#wss-title').val(), module: root.find('#wss-module').val(), target_workspace: root.find('#wss-target').val(), scope, icon: wsIcon,
            assignments: JSON.stringify(assignments), layout: JSON.stringify(state.layout), navigation: JSON.stringify(state.navigation), dock: JSON.stringify(state.dock)});
        current = result.name; dirty = false; setStatus(__('Saved draft'), 'ok'); await refresh();
    }
    async function loadDesign(next) {
        const doc = next ? await call('load', {name: next}) : {};
        const loaded = M.load(doc); // Parse before replacing the active design.
        state = loaded; current = next; scope = doc.scope || 'Global'; wsIcon = doc.icon || ''; selected = null; dirty = false;
        assignments = Array.isArray(doc.assignments) ? doc.assignments.map(a => ({target_type: a.target_type, target_name: a.target_name, enabled: Number(a.enabled ?? 1), priority: Number(a.priority ?? 100)})) : [];
        hist.clear();
        root.find('#wss-title').val(doc.workspace_title || ''); setModule(doc.module_name || ''); root.find('#wss-target').val(doc.target_workspace || ''); root.find('#wss-existing').val(next || '');
        setStatus(next ? (doc.status || __('Loaded')) : __('New design'), doc.status === 'Published' ? 'ok' : ''); root.find('#wss-errors').empty(); render();
    }
    root.find('#wss-save').on('click', working(() => save(false)));
    root.find('#wss-existing').on('change', working(async () => {
        const next = root.find('#wss-existing').val() || null;
        if (dirty && !window.confirm('Discard unsaved changes?')) { root.find('#wss-existing').val(current || ''); return; }
        await loadDesign(next);
    }));
    // The note callback saves the exact visible design before invoking the existing guarded publisher.
    root.find('#wss-publish').on('click', () => {
        if (!boot.can_publish || errors(true).length) return;
        frappe.prompt([{fieldtype: 'Small Text', fieldname: 'note', label: 'Publish note', reqd: 1}], values => working(async () => {
            await save(true); const result = await call('publish', {name: current, note: values.note});
            root.find('#wss-target').val(result.workspace); setStatus(__('Published · backup {0}', [result.version]), 'ok');
            frappe.msgprint({title: __('Native publication result'), message: __('Workspace: {0}<br>Sidebar: {1}<br>Dock: {2}<br>Desktop Icons: {3}<br>Backup version: {4}', [esc(result.workspace), esc(result.sidebar || 'Not requested'), esc(result.dock || 'Not requested'), esc((result.desktop_icons || []).join(', ') || 'Not requested'), esc(result.version)])});
        })(), __('Publish to native ERPNext'), __('Publish'));
    });
    root.find('#wss-history').on('click', working(async () => {
        if (!current) throw Error('Save a design first.');
        const versions = await call('versions', {name: current});
        const dlg = new frappe.ui.Dialog({title: __('Version history'), fields: [{fieldtype: 'HTML', fieldname: 'history'}]});
        const host = $('<div class="wss-history"></div>').appendTo(dlg.fields_dict.history.$wrapper);
        versions.forEach(v => {
            const line = $('<div class="wss-history-row"></div>').attr('data-action', v.action).append($('<b></b>').text('#' + v.version_number), $('<span class="wss-pill"></span>').text(v.action), $('<span></span>').text(v.change_summary || ''), $('<small></small>').text(v.creation ? frappe.datetime?.comment_when?.(v.creation) || v.creation : ''));
            if (v.action === 'Published') $('<button class="btn btn-default btn-xs">Rollback</button>').on('click', () => frappe.confirm(__('Restore this native backup? Later manual changes will be checked before restoring.'), () => working(async () => {
                const result = await call('rollback', {version_name: v.name, note: 'Restored from visual designer'}); dlg.hide(); frappe.msgprint(__('Restored {0} native documents.', [result.restored])); setStatus(__('Native backup restored; design remains a draft'), 'warn');
            })())).appendTo(line);
            host.append(line);
        });
        if (!versions.length) host.text('No saved versions.');
        dlg.show();
    }));

    // Open a specific design when routed from the Studio Workspace form.
    async function openRouted() {
        const wanted = frappe.route_options && frappe.route_options.design;
        if (!wanted) return;
        frappe.route_options = null;
        if (wanted !== current && (!dirty || window.confirm('Discard unsaved changes?'))) await working(() => loadDesign(wanted))();
    }
    frappe.pages['workspace-studio'].on_page_show = () => { openRouted(); };

    try {
        await refresh();
        root.find('#wss-save').prop('disabled', false);
        root.find('#wss-publish').prop('disabled', !boot.can_publish).attr('title', boot.can_publish ? 'Publish saved design' : 'Enable guarded publishing in Studio Settings');
        render();
        await openRouted();
    } catch (e) { root.find('#wss-errors').text(e.message || 'Unable to load Workspace Studio.'); }
};
