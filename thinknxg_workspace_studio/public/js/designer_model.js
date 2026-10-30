/* Pure operations shared by the visual designer and regression tests.
 * Nothing here touches the DOM or Frappe, so every drag/drop, resize and
 * nesting rule can be exercised under node:test. */
(function (root) {
    const clone = x => JSON.parse(JSON.stringify(x));
    const types = ['heading','text','shortcut','chart','number_card','quick_list','spacer'];
    const depth = row => Number(row && row.indent || 0);
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
    // End (exclusive) of the Sidebar subtree that starts at index.
    function subtreeEnd(list, index, nested = true) {
        let end = index + 1;
        if (nested) while (end < list.length && depth(list[end]) > depth(list[index])) end++;
        return end;
    }
    // Clamp every row so that it is at most one level deeper than its predecessor.
    function normalize(list) {
        list.forEach((row, i) => {
            const max = i ? depth(list[i-1]) + 1 : 0;
            if (depth(row) > max || depth(row) < 0) row.indent = Math.max(0, Math.min(max, depth(row)));
        });
        return list;
    }
    // Move a complete Sidebar subtree; refuse drops into its own descendants.
    function move(list, from, to, nested = false) {
        if (from < 0 || from >= list.length || to < 0 || to > list.length) return from;
        const end = subtreeEnd(list, from, nested);
        if (to >= from && to <= end) return from;
        const group = list.splice(from, end-from);
        if (to > from) to -= group.length;
        if (nested) {
            const first = depth(group[0]);
            const allowed = to ? depth(list[to-1])+1 : 0;
            if (first > allowed) for (const row of group) row.indent = depth(row) + allowed-first;
            list.splice(to,0,...group);
            normalize(list);
            return to;
        }
        list.splice(to,0,...group);
        return to;
    }
    function indent(list, index, delta) {
        const row = list[index]; if (!row) return;
        const old = depth(row), next = old + delta;
        if (next < 0 || (delta > 0 && (!index || next > depth(list[index-1])+1))) return;
        const end = subtreeEnd(list, index);
        for (let i=index;i<end;i++) list[i].indent = depth(list[i])+delta;
        normalize(list);
    }
    /* Insert or move a Sidebar subtree at an insertion index with a requested
     * depth (from the pointer's horizontal offset). Dropping a row inside its
     * own subtree keeps it in place and only re-nests it. Returns the new index. */
    function sidebarDrop(list, from, to, wanted, row = null) {
        let group;
        if (from == null) group = [row || {}];
        else {
            if (from < 0 || from >= list.length) return from;
            const end = subtreeEnd(list, from);
            if (to >= from && to <= end) to = from;
            group = list.splice(from, end-from);
            if (to > from) to -= group.length;
        }
        to = Math.max(0, Math.min(list.length, to));
        const max = to ? depth(list[to-1]) + 1 : 0;
        const target = Math.max(0, Math.min(max, Math.round(Number(wanted) || 0)));
        const delta = target - depth(group[0]);
        for (const item of group) item.indent = Math.max(0, depth(item) + delta);
        list.splice(to, 0, ...group);
        normalize(list);
        return to;
    }
    /* Insertion index for a pointer over a list of item rectangles in visual
     * order. Works for vertical lists, horizontal bars and wrapping grids. */
    function dropIndex(rects, point, mode = 'vertical') {
        let index = 0;
        rects.forEach((r, i) => {
            const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
            let before;
            if (mode === 'vertical') before = point.y > cy;
            else if (mode === 'horizontal') before = point.x > cx;
            else before = point.y > r.bottom || (point.y >= r.top && point.x > cx);
            if (before) index = i + 1;
        });
        return index;
    }
    // Columns from a resize gesture: width in pixels over one grid column pitch.
    function columnsFor(width, pitch, gap = 0) {
        if (!(pitch > 0)) return 1;
        return Math.max(1, Math.min(12, Math.round((width + gap) / pitch)));
    }
    function newId() { return Math.random().toString(36).slice(2, 12); }
    // Duplicate an item (and its Sidebar descendants) directly after itself.
    function duplicate(list, index, nested = false) {
        if (!list[index]) return index;
        const end = subtreeEnd(list, index, nested);
        const copy = clone(list.slice(index, end));
        for (const row of copy) {
            if ('id' in row) row.id = newId();
            for (const key of ['title','label']) if (row[key] && row === copy[0]) row[key] = row[key] + ' (copy)';
        }
        list.splice(end, 0, ...copy);
        return end;
    }
    // Bounded undo/redo over serialised design states.
    function history(limit = 60) {
        const past = [], future = [];
        return {
            record(snapshot) { past.push(snapshot); if (past.length > limit) past.shift(); future.length = 0; },
            undo(current) { if (!past.length) return null; future.push(current); return past.pop(); },
            redo(current) { if (!future.length) return null; past.push(current); return future.pop(); },
            get canUndo() { return past.length > 0; },
            get canRedo() { return future.length > 0; },
            clear() { past.length = 0; future.length = 0; }
        };
    }
    const ASSIGNMENT_TYPES = ['Role','User','Department','Company'];
    function validateAssignments(scope, list, requireTarget = true) {
        const errors = [];
        (list || []).forEach((a, i) => {
            if (!ASSIGNMENT_TYPES.includes(a.target_type)) errors.push('Audience ' + (i+1) + ': unsupported target type');
            if (!String(a.target_name || '').trim()) errors.push('Audience ' + (i+1) + ': choose a ' + (a.target_type || 'target'));
        });
        if (requireTarget && scope && scope !== 'Global' && !(list || []).some(a => a.target_type === scope && Number(a.enabled ?? 1) && String(a.target_name || '').trim()))
            errors.push('Audience: add at least one ' + scope + ' for a ' + scope + '-scoped design');
        return errors;
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
                if (surface === 'sidebar' && (!Number.isInteger(depth(row)) || depth(row) < 0 || depth(row) > (i ? depth(list[i-1])+1 : 0))) errors.push(at + ': invalid nesting');
            });
        }
        return errors;
    }
    root.WorkspaceStudioModel = {clone,types,load,rows,move,indent,validate,subtreeEnd,normalize,sidebarDrop,dropIndex,columnsFor,duplicate,history,validateAssignments,ASSIGNMENT_TYPES};
})(typeof window === 'undefined' ? globalThis : window);
