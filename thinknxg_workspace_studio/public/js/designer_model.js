/* Pure operations shared by the designer and regression tests. */
(function (root) {
    const clone = x => JSON.parse(JSON.stringify(x));
    const types = ['heading','text','shortcut','chart','number_card','quick_list','spacer'];
    function parse(value, fallback) {
        const result = typeof value === 'string' ? JSON.parse(value || '{}') : clone(value || fallback);
        if (!result || Array.isArray(result) || typeof result !== 'object') throw Error('Expected a design object');
        return result;
    }
    function load(doc = {}) {
        const layout = parse(doc.layout_json, {version:1,components:[]});
        const navigation = parse(doc.navigation_json, {}), dock = parse(doc.dock_json, {});
        if (!('components' in layout)) layout.components = [];
        for (const [object,key] of [[layout,'components'],[navigation,'items'],[dock,'entries'],[dock,'desktop_icons']]) {
            if (key in object && !Array.isArray(object[key])) throw Error(key + ' must be a list');
            if (object[key]?.some(row => !row || typeof row !== 'object' || Array.isArray(row) || row.config != null && (typeof row.config !== 'object' || Array.isArray(row.config)))) throw Error(key + ' contains an invalid item');
        }
        return {layout,navigation,dock};
    }
    function rows(state, surface, create = false) {
        const [object,key] = surface === 'workspace' ? [state.layout,'components'] : surface === 'sidebar' ? [state.navigation,'items'] : [state.dock,surface === 'dock' ? 'entries' : 'desktop_icons'];
        if (create && !object[key]) object[key] = [];
        return object[key] || [];
    }
    // Move a complete Sidebar subtree; refuse drops into its own descendants.
    function move(list, from, to, nested = false) {
        if (from < 0 || from >= list.length || to < 0 || to > list.length) return from;
        let end = from + 1;
        if (nested) while (end < list.length && Number(list[end].indent || 0) > Number(list[from].indent || 0)) end++;
        if (to >= from && to <= end) return from;
        const group = list.splice(from, end-from);
        if (to > from) to -= group.length;
        if (nested) {
            const depth = Number(group[0].indent || 0);
            const allowed = to ? Number(list[to-1].indent || 0)+1 : 0;
            if (depth > allowed) for (const row of group) row.indent = Number(row.indent || 0) + allowed-depth;
        }
        list.splice(to,0,...group);
        return to;
    }
    function indent(list, index, delta) {
        const row = list[index]; if (!row) return;
        const old = Number(row.indent || 0), next = old + delta;
        if (next < 0 || (delta > 0 && (!index || next > Number(list[index-1].indent || 0)+1))) return;
        let end = index+1;
        while (end < list.length && Number(list[end].indent || 0) > old) end++;
        for (let i=index;i<end;i++) list[i].indent = Number(list[i].indent || 0)+delta;
    }
    function validate(state) {
        const errors = [];
        for (const surface of ['workspace','sidebar','dock','desktop']) {
            const list = rows(state,surface);
            if (list.length > 250) errors.push(surface + ': maximum 250 items');
            const labels = new Set();
            list.forEach((row,i) => {
                const at = surface + ' item ' + (i+1), cfg = surface === 'workspace' ? row.config || {} : row;
                if (surface === 'workspace') {
                    if (!types.includes(row.type)) errors.push(at + ': unsupported component ' + row.type);
                    const key = {chart:'chart_name',number_card:'number_card_name',quick_list:'quick_list_name'}[row.type];
                    if (key && !String(cfg[key] || '').trim()) errors.push(at + ': choose a ' + row.type.replace('_',' '));
                    if (cfg.col != null && (!Number.isInteger(Number(cfg.col)) || cfg.col < 1 || cfg.col > 12)) errors.push(at + ': width must be 1–12');
                }
                const link = surface !== 'workspace' || row.type === 'shortcut';
                const linkType = cfg[surface === 'sidebar' ? 'type' : 'link_type'] || 'DocType';
                if (link && !['DocType','Report','Page','Workspace','Dashboard','Sidebar','Workspace Sidebar','External','URL'].includes(linkType)) errors.push(at + ': unsupported link type');
                if (link && ['URL','External'].includes(linkType) && !/^(https?:\/\/|\/app\/)/.test(cfg.link_to || '')) errors.push(at + ': use an http(s) URL or /app/ route');
                if (link && !String(cfg.link_to || cfg.sidebar || '').trim()) errors.push(at + ': choose a destination');
                const label = surface === 'workspace' || surface === 'dock' ? row.title : row.label;
                if ((link || surface === 'workspace' && row.type === 'heading') && !String(label || '').trim()) errors.push(at + ': title required');
                if (surface === 'desktop' || surface === 'workspace' && row.type === 'shortcut') {
                    if (labels.has(label)) errors.push(at + ': duplicate title'); labels.add(label);
                }
                if (surface === 'sidebar' && (!Number.isInteger(Number(row.indent || 0)) || Number(row.indent || 0) < 0 || Number(row.indent || 0) > (i ? Number(list[i-1].indent || 0)+1 : 0))) errors.push(at + ': invalid nesting');
            });
        }
        return errors;
    }
    root.WorkspaceStudioModel = {clone,types,load,rows,move,indent,validate};
})(typeof window === 'undefined' ? globalThis : window);
